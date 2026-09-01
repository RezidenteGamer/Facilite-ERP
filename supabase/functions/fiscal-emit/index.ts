/**
 * **`fiscal-emit` — onde a emissão fiscal passa a acontecer de verdade (A1, 01/09/2026).**
 *
 * Até aqui a nota fiscal era montada e "emitida" dentro do navegador: o front
 * lia a venda, montava o `NfePayload`, chamava o `FiscalProvider` e gravava o
 * resultado em `fiscal_documents` sob RLS. Três problemas, o último fatal:
 *
 * 1. O conteúdo da nota vinha do estado da tela — preço, desconto, total,
 *    alíquota. Um cliente adulterado declarava à SEFAZ o que quisesse.
 * 2. O token do provedor real (A12) teria de viver no bundle para a emissão
 *    funcionar — ou seja, público.
 * 3. Quem gravava era o cliente, então a policy de `insert`/`update` de
 *    `fiscal_documents` precisava existir — e uma policy de escrita em nota
 *    fiscal é uma porta que não deveria existir.
 *
 * Esta função fecha os três. Ela roda com `service_role`, valida o chamador por
 * JWT (mesmo padrão de `admin-users`), **lê do banco tudo que descreve a nota**
 * e só então chama o provedor e persiste. Do cliente vem apenas *o que* emitir
 * (qual venda, qual devolução, qual modelo) — nunca *com que valores*.
 *
 * ## Escopo: `emit`, `cancel`, `query`
 *
 * São as operações que o produto exerce hoje. Os outros quatro métodos do
 * contrato (`correctionLetter`, `invalidateRange`, `getXml`, `getDanfe`) existem
 * desde A2 mas nenhuma tela os expõe — os botões de carta de correção seguem
 * `disabled: true` em `InvoicesPage.tsx`. Ligá-los é tarefa futura, e o lugar
 * será aqui.
 *
 * `query` também ainda não tem tela: ela existe porque a emissão do provedor
 * real é assíncrona (a API responde 202 e a autorização sai depois), e é por
 * ela que uma nota em `processando_autorizacao` vira `autorizado`.
 *
 * ## O contrato de retorno não mudou
 *
 * `{ ok: boolean, errors: string[] }`, o mesmo `EmitOutcome` de sempre. Rejeição
 * da SEFAZ é resultado de negócio e volta com `ok: false` e HTTP 200 — nunca
 * exceção. Erro HTTP fica reservado a falha de transporte, permissão e
 * configuração ausente (`FiscalNotConfiguredError`), que é o que o front já
 * traduz em mensagem na tela.
 *
 * ## Três arquivos, e não um
 *
 * `admin-users` cabe em um arquivo; esta não caberia. `data.ts` é a leitura (o
 * ponto da tarefa), `persist.ts` é a escrita nas três tabelas de A3, e este
 * arquivo é a borda HTTP: CORS, autenticação, permissão e despacho. A fronteira
 * entre "o que eu li do banco" e "o que eu gravo" é justamente o que precisa
 * ficar legível numa revisão de segurança.
 *
 * ## Depende da migration de A3
 *
 * O cabeçalho completo, `fiscal_document_items` e `fiscal_document_events` vêm
 * de `00000000000003_a3_modelo_canonico_documento_fiscal.sql`. Implantar esta
 * função **antes** de aplicar aquela migration faz toda emissão falhar no
 * insert. A ordem é: migration de A3 → migration de A1 → deploy.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

import {
  buildNfcePayloadFromSale,
  buildNfePayloadFromSale,
  buildReturnNfePayload,
} from "../_shared/fiscal/invoiceMapping.ts";
import { FiscalNotConfiguredError, type FiscalProvider } from "../_shared/fiscal/provider.ts";
import { saleFiscalRef, saleReturnFiscalRef } from "../_shared/fiscal/refs.ts";
import {
  createFiscalProvider,
  resolveFiscalProviderId,
  type FiscalProviderId,
} from "../_shared/fiscal/registry.ts";
import type { SimulatedFiscalProviderSeed } from "../_shared/fiscal/simulatedFiscalProvider.ts";
import type { FiscalArtifact, FiscalModel, FiscalStatus, NfePayload } from "../_shared/fiscal/types.ts";

import { FiscalDataError, readSaleForInvoice, readSaleReturnForInvoice, readTaxRules } from "./data.ts";
import {
  persistCancel,
  persistEmission,
  persistQueryStatus,
  readDocumentByRef,
  readLastNumero,
  type FiscalAmbiente,
  type FiscalDocumentOrigin,
  type FiscalDocumentRow,
} from "./persist.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Rejeição de negócio: HTTP 200 com o mesmo shape de `EmitOutcome`. */
function outcome(errors: string[], extra: Record<string, unknown> = {}) {
  return jsonResponse({ ok: errors.length === 0, errors, ...extra });
}

/* ------------------------------------------------------------------------ */
/* O que o cliente pode pedir                                                */
/* ------------------------------------------------------------------------ */

/**
 * **A `ref` não está aqui, e é de propósito.** Ela é derivada do id da venda ou
 * da devolução dentro desta função (`refFor`): aceitá-la pronta deixaria o
 * cliente escolher em qual linha de `fiscal_documents` (única por `ref`) o
 * resultado cairia. Ver `_shared/fiscal/refs.ts`.
 */
type RequestPayload = {
  action?: unknown;
  branchId?: unknown;
  saleId?: unknown;
  saleReturnId?: unknown;
  model?: unknown;
  justificativa?: unknown;
};

type FiscalAction = "emit" | "cancel" | "query";

/** A permissão de `notas-emitidas` que cada ação exige, no mesmo vocabulário do RBAC. */
const REQUIRED_PERMISSION: Record<FiscalAction, string> = {
  emit: "create",
  cancel: "edit",
  query: "view",
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function refFor(origin: FiscalDocumentOrigin): string {
  return "saleId" in origin ? saleFiscalRef(origin.saleId) : saleReturnFiscalRef(origin.saleReturnId);
}

function describeOrigin(origin: FiscalDocumentOrigin): string {
  return "saleId" in origin ? "venda" : "devolução";
}

/* ------------------------------------------------------------------------ */
/* Provedor e ambiente                                                       */
/* ------------------------------------------------------------------------ */

/**
 * O ambiente declarado na nota (`tpAmb`).
 *
 * Falha fechado em dois eixos: o provedor simulado é **sempre** homologação
 * (um documento que ninguém enviou à SEFAZ nunca tem valor fiscal, por mais que
 * a variável de ambiente diga o contrário), e qualquer valor que não seja
 * exatamente `producao` também vira homologação.
 */
function resolveAmbiente(providerId: FiscalProviderId): FiscalAmbiente {
  if (providerId !== "focus-nfe") return "homologacao";
  return Deno.env.get("FISCAL_AMBIENTE")?.trim() === "producao" ? "producao" : "homologacao";
}

function toArtifact(content: string | null, path: string | null, contentType: string): FiscalArtifact | null {
  if (!content && !path) return null;
  return { content, path, contentType };
}

/**
 * A nota que já está no banco, no formato que o provedor simulado sabe
 * restaurar.
 *
 * Existe porque o simulado guarda estado em memória e cada requisição desta
 * função pode cair num isolate novo: sem isto, cancelar uma nota emitida
 * ontem responderia `nao_encontrado` para um documento que está `autorizado`
 * no banco. Ver `seed` em `simulatedFiscalProvider.ts`.
 */
function seedFromRow(row: FiscalDocumentRow): SimulatedFiscalProviderSeed["documents"] {
  return [
    {
      ref: row.ref,
      model: row.model,
      status: row.status as FiscalStatus,
      chave: row.chave,
      numero: row.numero,
      serie: row.serie,
      protocolo: row.protocolo,
      statusSefaz: row.status_sefaz,
      mensagemSefaz: row.mensagem_sefaz,
      xml: toArtifact(row.xml_content, row.xml_path, "application/xml"),
      pdf: toArtifact(row.pdf_content, row.pdf_path, "text/html"),
      xmlCancelamento: null,
      qrCodeUrl: row.qr_code_url,
      cnpjEmitente: row.emitente_cnpj ?? "",
    },
  ];
}

/* ------------------------------------------------------------------------ */
/* As três ações                                                             */
/* ------------------------------------------------------------------------ */

type Context = {
  admin: SupabaseClient;
  providerId: FiscalProviderId;
  ambiente: FiscalAmbiente;
  branchId: string;
  userId: string;
};

/**
 * Monta o payload da nota a partir **do que foi lido do banco**. É o único lugar
 * que decide qual dos três mapeamentos se aplica.
 */
async function buildPayload(
  ctx: Context,
  origin: FiscalDocumentOrigin,
  model: FiscalModel,
): Promise<{ ok: true; payload: NfePayload } | { ok: false; errors: string[] }> {
  const rules = await readTaxRules(ctx.admin);

  if ("saleReturnId" in origin) {
    if (model !== "nfe") {
      return { ok: false, errors: ["Devolução só é emitida como NF-e (modelo 55)."] };
    }
    const { branchId, saleReturn } = await readSaleReturnForInvoice(ctx.admin, origin.saleReturnId);
    if (branchId !== ctx.branchId) {
      return { ok: false, errors: ["A devolução não pertence à filial informada."] };
    }
    const built = buildReturnNfePayload(saleReturn, rules);
    return built.ok ? { ok: true, payload: built.payload } : { ok: false, errors: built.errors };
  }

  const { branchId, sale } = await readSaleForInvoice(ctx.admin, origin.saleId);
  if (branchId !== ctx.branchId) {
    return { ok: false, errors: ["A venda não pertence à filial informada."] };
  }
  const built = model === "nfce" ? buildNfcePayloadFromSale(sale, rules) : buildNfePayloadFromSale(sale, rules);
  return built.ok ? { ok: true, payload: built.payload } : { ok: false, errors: built.errors };
}

async function handleEmit(ctx: Context, origin: FiscalDocumentOrigin, model: FiscalModel): Promise<Response> {
  const ref = refFor(origin);
  const existing = await readDocumentByRef(ctx.admin, ref);

  // A `ref` é derivada do id que veio na requisição, e a nota que ela encontra
  // pode ser de outra filial — o chamador escolhe `saleId` e `branchId`
  // separadamente. Sem esta checagem, o atalho de idempotência abaixo devolveria
  // a chave de acesso de uma nota de filial à qual quem pediu não tem acesso.
  // A checagem de filial que existe em `buildPayload` só roda depois, e portanto
  // não protege o caminho curto.
  if (existing && existing.branch_id !== ctx.branchId) {
    return outcome([`Esta ${describeOrigin(origin)} não pertence à filial informada.`]);
  }

  // Idempotência antes de falar com o provedor: uma nota que já chegou a um
  // estado terminal não é reemitida. É o que protege contra duplo clique, contra
  // retry de rede — e contra sobrescrever uma nota autorizada com outra.
  if (existing && existing.status === "autorizado") {
    if (existing.model !== model) {
      return outcome([
        `Esta ${describeOrigin(origin)} já tem uma ${existing.model === "nfce" ? "NFC-e" : "NF-e"} ` +
          `autorizada (chave ${existing.chave ?? "—"}). Cancele-a antes de emitir outro modelo.`,
      ]);
    }
    return outcome([], { chave: existing.chave, status: existing.status });
  }
  if (existing && existing.status === "cancelado") {
    return outcome([`A nota desta ${describeOrigin(origin)} já foi cancelada e não pode ser reemitida.`]);
  }

  const built = await buildPayload(ctx, origin, model);
  if (!built.ok) return outcome(built.errors);

  // A numeração só precisa ser restaurada para o provedor simulado — o real
  // numera do lado dele. Consultar o banco para os dois seria uma leitura a
  // mais por emissão, em troca de nada.
  const lastNumbers =
    ctx.providerId === "simulado"
      ? [
          {
            cnpj: built.payload.cnpj_emitente,
            model,
            ultimoNumero: await readLastNumero(ctx.admin, ctx.branchId, model),
          },
        ]
      : undefined;

  const provider = createProvider(ctx, { lastNumbers });
  const document = await provider.emit({ ref, model, payload: built.payload });
  await persistEmission(ctx.admin, {
    branchId: ctx.branchId,
    origin,
    model,
    ambiente: ctx.ambiente,
    payload: built.payload,
    document,
    createdBy: ctx.userId,
  });

  if (document.status !== "autorizado") {
    return outcome([document.mensagemSefaz ?? "A SEFAZ recusou a emissão."], { status: document.status });
  }
  return outcome([], { chave: document.chave, status: document.status });
}

async function handleCancel(
  ctx: Context,
  origin: FiscalDocumentOrigin,
  justificativa: string,
): Promise<Response> {
  const ref = refFor(origin);
  const existing = await readDocumentByRef(ctx.admin, ref);
  if (!existing) {
    return outcome([`Esta ${describeOrigin(origin)} não tem nota emitida para cancelar.`]);
  }
  if (existing.branch_id !== ctx.branchId) {
    return outcome(["A nota não pertence à filial informada."]);
  }

  const provider = createProvider(ctx, { documents: seedFromRow(existing) });
  const result = await provider.cancel({ ref, justificativa });

  if (result.status !== "cancelado") {
    // Recusa do evento não muda o status do documento — nada é gravado.
    return outcome([result.mensagemSefaz ?? "Não foi possível cancelar o documento."]);
  }

  await persistCancel(ctx.admin, {
    documentId: existing.id,
    branchId: ctx.branchId,
    ambiente: ctx.ambiente,
    result,
    justificativa,
    createdBy: ctx.userId,
  });
  return outcome([], { status: "cancelado" });
}

async function handleQuery(ctx: Context, origin: FiscalDocumentOrigin): Promise<Response> {
  const ref = refFor(origin);
  const existing = await readDocumentByRef(ctx.admin, ref);
  if (!existing) {
    return outcome([`Esta ${describeOrigin(origin)} não tem nota emitida.`]);
  }
  if (existing.branch_id !== ctx.branchId) {
    return outcome(["A nota não pertence à filial informada."]);
  }

  const provider = createProvider(ctx, { documents: seedFromRow(existing) });
  const document = await provider.query(ref);

  // `nao_encontrado` não existe em `fiscal_document_status` — e não deveria
  // sobrescrever o que o banco sabe sobre a nota. Volta como resultado.
  if (document.status === "nao_encontrado") {
    return outcome(["O provedor não conhece esta nota."], { status: existing.status });
  }

  await persistQueryStatus(ctx.admin, existing.id, document);
  return outcome([], { status: document.status, chave: document.chave });
}

function createProvider(ctx: Context, seed: SimulatedFiscalProviderSeed): FiscalProvider {
  return createFiscalProvider(ctx.providerId, { simulatedSeed: seed });
}

/* ------------------------------------------------------------------------ */
/* Borda HTTP                                                                */
/* ------------------------------------------------------------------------ */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não suportado." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Corpo da requisição inválido." }, 400);
  }

  const action = payload.action;
  if (action !== "emit" && action !== "cancel" && action !== "query") {
    return jsonResponse({ error: "Ação desconhecida." }, 400);
  }
  if (!isNonEmptyString(payload.branchId)) {
    return jsonResponse({ error: "branchId é obrigatório." }, 400);
  }
  const branchId = payload.branchId;

  const hasSale = isNonEmptyString(payload.saleId);
  const hasSaleReturn = isNonEmptyString(payload.saleReturnId);
  if (hasSale === hasSaleReturn) {
    return jsonResponse({ error: "Informe exatamente um entre saleId e saleReturnId." }, 400);
  }
  const origin: FiscalDocumentOrigin = hasSale
    ? { saleId: payload.saleId as string }
    : { saleReturnId: payload.saleReturnId as string };

  let model: FiscalModel = "nfe";
  if (action === "emit") {
    if (payload.model !== "nfe" && payload.model !== "nfce") {
      return jsonResponse({ error: "model deve ser 'nfe' ou 'nfce'." }, 400);
    }
    model = payload.model;
  }

  let justificativa = "";
  if (action === "cancel") {
    if (typeof payload.justificativa !== "string") {
      return jsonResponse({ error: "justificativa é obrigatória para cancelar." }, 400);
    }
    // O tamanho (15 a 255, regra da SEFAZ) quem confere é o provedor — a recusa
    // dele é a mensagem que a tela já sabe mostrar.
    justificativa = payload.justificativa;
  }

  /* --- Autenticação e permissão, antes de qualquer leitura ou escrita --- */

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return jsonResponse({ error: "Não autenticado." }, 401);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Não autenticado." }, 401);
  }

  // As duas checagens rodam **pelo cliente do chamador**, não pelo `service_role`:
  // `has_permission` e `has_branch_access` decidem por `auth.uid()`, que sob
  // service_role seria nulo e devolveria false para todo mundo.
  const [{ data: canDo, error: permissionError }, { data: hasBranch, error: branchError }] =
    await Promise.all([
      callerClient.rpc("has_permission", {
        p_module_id: "notas-emitidas",
        p_action: REQUIRED_PERMISSION[action],
      }),
      callerClient.rpc("has_branch_access", { p_branch_id: branchId }),
    ]);
  if (permissionError || branchError) {
    return jsonResponse(
      { error: `Erro ao checar permissão: ${(permissionError ?? branchError)!.message}` },
      500,
    );
  }
  if (!canDo) {
    return jsonResponse({ error: "Você não tem permissão para esta operação em Notas Emitidas." }, 403);
  }
  if (!hasBranch) {
    return jsonResponse({ error: "Você não tem acesso a esta filial." }, 403);
  }

  /* --- A partir daqui, service_role --- */

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const providerId = resolveFiscalProviderId(Deno.env.get("FISCAL_PROVIDER"), (message) =>
    console.warn(message),
  );
  const ctx: Context = {
    admin,
    providerId,
    ambiente: resolveAmbiente(providerId),
    branchId,
    userId: userData.user.id,
  };

  try {
    if (action === "emit") return await handleEmit(ctx, origin, model);
    if (action === "cancel") return await handleCancel(ctx, origin, justificativa);
    return await handleQuery(ctx, origin);
  } catch (err) {
    // Erro de negócio da leitura (venda inexistente, cancelada, item sem
    // produto) volta como resultado, no mesmo shape de sempre.
    if (err instanceof FiscalDataError) return outcome([err.message]);
    // Provedor não configurado é falha de sistema, não recusa da SEFAZ — dizer
    // "a nota foi rejeitada" mandaria o operador procurar erro no cadastro.
    if (err instanceof FiscalNotConfiguredError) return jsonResponse({ error: err.message }, 500);

    const message = err instanceof Error && err.message ? err.message : String(err);
    console.error("[fiscal-emit]", action, message);
    return jsonResponse({ error: message }, 500);
  }
});
