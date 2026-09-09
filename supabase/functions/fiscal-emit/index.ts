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
 * ## Escopo: `emit`, `cancel`, `query` — e, desde A7, `sweep`
 *
 * São as operações que o produto exerce hoje. Os outros quatro métodos do
 * contrato (`correctionLetter`, `invalidateRange`, `getXml`, `getDanfe`) existem
 * desde A2 mas nenhuma tela os expõe — os botões de carta de correção seguem
 * `disabled: true` em `InvoicesPage.tsx`. Ligá-los é tarefa futura, e o lugar
 * será aqui.
 *
 * `query` **passou a ter tela em A6** (09/09/2026): o botão "Consultar status"
 * de `InvoicesPage.tsx`. Entre A1 e A6 ela existiu sem chamador nenhum — viva no
 * código, morta no produto. Ela existe porque a emissão do provedor real é
 * assíncrona (a API responde 202 e a autorização sai depois), e é por ela que
 * uma nota em `processando_autorizacao` vira `autorizado`; A6 acrescentou o
 * outro desfecho, o de uma reserva que ficou órfã porque o isolate morreu.
 *
 * ## A emissão é travada no banco (A5, 07/09/2026)
 *
 * A `ref` já era derivada aqui dentro desde A1; o que faltava era travá-la. Entre
 * o `readDocumentByRef` do começo de `handleEmit` e o `persistEmission` do fim
 * há trabalho assíncrono de verdade, e duas requisições para a mesma venda
 * podiam passar as duas pela leitura antes de qualquer uma escrever — emitindo
 * duas notas e gravando uma por cima da outra. Agora a primeira escrita é uma
 * **reserva atômica** (`reserveEmission`), antes de falar com o provedor, e quem
 * perde a corrida devolve o resultado de quem ganhou em vez de emitir de novo.
 * O raciocínio inteiro, com o que ficou para A6 e A7, está em `reservation.ts`.
 *
 * ## E a reserva que fica órfã tem saída (A6, 09/09/2026)
 *
 * A5 garantia que `processando_autorizacao` não sobrevive à requisição que o
 * escreveu — garantia que vale para o código, não para a execução: um isolate
 * morto por limite de CPU, de memória ou por uma implantação não roda o `catch`
 * de `handleEmit`, e a reserva fica pendurada. `handleQuery` passa a ser o
 * caminho de resolução, sempre pela mesma regra: **consultar o provedor pela
 * `ref` antes de decidir**, porque liberar sem perguntar criaria a segunda nota
 * real que A5 existe para impedir. Ver `decideConsulta` em `reservation.ts`.
 *
 * ## O contrato de retorno não mudou
 *
 * `{ ok: boolean, errors: string[] }`, o mesmo `EmitOutcome` de sempre. Rejeição
 * da SEFAZ é resultado de negócio e volta com `ok: false` e HTTP 200 — nunca
 * exceção. Erro HTTP fica reservado a falha de transporte, permissão e
 * configuração ausente (`FiscalNotConfiguredError`), que é o que o front já
 * traduz em mensagem na tela.
 *
 * ## E a resolução deixa de depender de alguém clicar (A7, 09/09/2026)
 *
 * A6 deu saída à reserva órfã, mas só quando um operador abre Notas Emitidas e
 * clica. Uma venda emitida às 18h de sexta ficaria presa até segunda, e o
 * operador nem tem como saber que precisa clicar — a tela diz "em andamento".
 * A ação `sweep` é o mesmo caminho de A6 chamado por um `cron.schedule`, a cada
 * 5 minutos, sobre as reservas mais velhas que o limite de relógio da
 * plataforma. **Ela não emite nem reemite nada**: o que entra na fila, e por que
 * `erro_autorizacao` ficou de fora, está em `queue.ts`.
 *
 * ## Cinco arquivos, e não um
 *
 * `admin-users` cabe em um arquivo; esta não caberia. `data.ts` é a leitura (o
 * ponto de A1), `persist.ts` é a escrita nas quatro tabelas (as três de A3 mais
 * `fiscal_queue`, de A7), `reservation.ts` é a tabela de estados da emissão
 * (A5/A6) e `queue.ts` é a regra de quando perguntar sem humano presente (A7)
 * — os dois últimos sem I/O, para caberem num teste de unidade —, e este arquivo
 * é a borda HTTP: CORS, autenticação, permissão e despacho. A fronteira entre "o
 * que eu li do banco" e "o que eu gravo" é justamente o que precisa ficar
 * legível numa revisão de segurança.
 *
 * ## Depende da migration de A3
 *
 * O cabeçalho completo, `fiscal_document_items` e `fiscal_document_events` vêm
 * de `00000000000003_a3_modelo_canonico_documento_fiscal.sql`. Implantar esta
 * função **antes** de aplicar aquela migration faz toda emissão falhar no
 * insert. A ordem é: migration de A3 → migration de A1 → deploy.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  buildNfcePayloadFromSale,
  buildNfePayloadFromSale,
  buildReturnNfePayload,
} from "../_shared/fiscal/invoiceMapping.ts";
import { validarPayloadFiscal } from "../_shared/fiscal/payloadValidation.ts";
import { FiscalNotConfiguredError } from "../_shared/fiscal/provider.ts";
import { saleFiscalRef, saleReturnFiscalRef } from "../_shared/fiscal/refs.ts";
import { resolveFiscalProviderId } from "../_shared/fiscal/registry.ts";
import type { FiscalDocument, FiscalModel, NfePayload } from "../_shared/fiscal/types.ts";

import { decideAcessoPorSegredo } from "../_shared/http/sharedSecret.ts";

import {
  FiscalDataError,
  readIbptRates,
  readMvaRules,
  readSaleForInvoice,
  readSaleReturnForInvoice,
  readTaxRules,
} from "./data.ts";
import {
  clearQueueEntry,
  persistCancel,
  persistEmission,
  readDocumentByRef,
  readLastNumero,
  readQueueEntries,
  readStuckReservations,
  releaseEmission,
  reserveEmission,
  saveQueueEntry,
  type FiscalDocumentOrigin,
  type StuckReservationRow,
} from "./persist.ts";
import {
  JANELA_CANDIDATOS,
  agendarAposAguardar,
  agendarAposFalha,
  corteDeIdade,
  selecionaLote,
} from "./queue.ts";
// O núcleo de reconciliação mora em `reconcile.ts` desde A8 (09/09/2026), para
// que a Edge Function `fiscal-webhook` — outro processo — possa chamar
// exatamente o mesmo código sem importar este arquivo (que chama `Deno.serve`).
import {
  createProvider,
  reconciliaComProvedor,
  resolveAmbiente,
  seedFromRow,
  type ProviderContext,
} from "./reconcile.ts";
import { decideAposPerderCorrida, decideEmissao } from "./reservation.ts";

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
/* As três ações                                                             */
/* ------------------------------------------------------------------------ */

type Context = ProviderContext & {
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
  // Os três cadastros que o mapeamento consulta: CFOP pela operação, MVA por
  // NCM × UF de **destino** e os percentuais da Lei da Transparência por NCM ×
  // UF de **origem** (B9 — a UF da filial, não a do cliente; ver
  // `ibptRates.ts`). Lidos em paralelo — são independentes entre si.
  const [rules, mvaRules, ibptRates] = await Promise.all([
    readTaxRules(ctx.admin),
    readMvaRules(ctx.admin),
    readIbptRates(ctx.admin),
  ]);

  if ("saleReturnId" in origin) {
    if (model !== "nfe") {
      return { ok: false, errors: ["Devolução só é emitida como NF-e (modelo 55)."] };
    }
    const { branchId, saleReturn } = await readSaleReturnForInvoice(ctx.admin, origin.saleReturnId);
    if (branchId !== ctx.branchId) {
      return { ok: false, errors: ["A devolução não pertence à filial informada."] };
    }
    const built = buildReturnNfePayload(saleReturn, rules, mvaRules, ibptRates);
    return built.ok ? { ok: true, payload: built.payload } : { ok: false, errors: built.errors };
  }

  const { branchId, sale } = await readSaleForInvoice(ctx.admin, origin.saleId);
  if (branchId !== ctx.branchId) {
    return { ok: false, errors: ["A venda não pertence à filial informada."] };
  }
  const built =
    model === "nfce"
      ? buildNfcePayloadFromSale(sale, rules, mvaRules, ibptRates)
      : buildNfePayloadFromSale(sale, rules, mvaRules, ibptRates);
  return built.ok ? { ok: true, payload: built.payload } : { ok: false, errors: built.errors };
}

async function handleEmit(ctx: Context, origin: FiscalDocumentOrigin, model: FiscalModel): Promise<Response> {
  const ref = refFor(origin);
  const origem = describeOrigin(origin);
  const existing = await readDocumentByRef(ctx.admin, ref);

  // A `ref` é derivada do id que veio na requisição, e a nota que ela encontra
  // pode ser de outra filial — o chamador escolhe `saleId` e `branchId`
  // separadamente. Sem esta checagem, o atalho de idempotência abaixo devolveria
  // a chave de acesso de uma nota de filial à qual quem pediu não tem acesso.
  // A checagem de filial que existe em `buildPayload` só roda depois, e portanto
  // não protege o caminho curto.
  if (existing && existing.branch_id !== ctx.branchId) {
    return outcome([`Esta ${origem} não pertence à filial informada.`]);
  }

  // Idempotência antes de falar com o provedor: uma nota que já chegou a um
  // estado terminal não é reemitida — e, desde A5, uma que está sendo emitida
  // agora também não. A tabela de estados mora em `reservation.ts`.
  const decisao = decideEmissao(existing, model, origem);
  if (decisao.kind === "responder") return outcome(decisao.errors, decisao.extra);

  const built = await buildPayload(ctx, origin, model);
  if (!built.ok) return outcome(built.errors);

  // **A validação estrutural roda aqui, antes de qualquer provedor (A9,
  // 09/09/2026).** Até A9 ela morava dentro do provedor simulado, o que a
  // amarrava à variável de ambiente: com `FISCAL_PROVIDER=focus` (A12) a nota
  // sairia para a rede sem crivo nenhum, gastando uma chamada — e possivelmente
  // um crédito — para voltar recusada por um CNPJ cujo dígito verificador não
  // fecha. Daqui ela alcança os dois provedores igualmente.
  //
  // Vem **antes** de `reserveEmission` pelo mesmo motivo que ela vem depois de
  // `buildPayload`: uma nota que não vai sair não deve deixar reserva pendurada
  // em `fiscal_documents` para A6/A7 terem de resolver depois.
  //
  // E volta como `outcome(errors)` — o mesmo formato dos erros do próprio
  // `buildPayload` —, não como `erro_autorizacao` com `cStat` da SEFAZ: ninguém
  // falou com a SEFAZ, e escrever que ela recusou seria inventar a resposta.
  const problemasDeEstrutura = validarPayloadFiscal(built.payload, model);
  if (problemasDeEstrutura.length > 0) return outcome(problemasDeEstrutura);

  // **A reserva vem depois de `buildPayload`, e é de propósito.** É
  // `readSaleForInvoice` (dentro dele) que confere que a venda pertence mesmo à
  // filial pedida; reservar antes gravaria uma linha de `fiscal_documents` com
  // a filial que o chamador *disse*, para uma venda que pode ser de outra.
  // A janela que a reserva precisa cobrir é a que vai daqui até a escrita do
  // desfecho — a chamada ao provedor —, e essa ela cobre inteira.
  const reservation = await reserveEmission(ctx.admin, {
    ref,
    branchId: ctx.branchId,
    origin,
    model,
    ambiente: ctx.ambiente,
    createdBy: ctx.userId,
    existing,
  });
  if (!reservation.reserved) {
    const atual = await readDocumentByRef(ctx.admin, ref);
    const resposta = decideAposPerderCorrida(atual, model, origem);
    return outcome(resposta.errors, resposta.extra);
  }

  let document: FiscalDocument;
  try {
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
    document = await provider.emit({ ref, model, payload: built.payload });

    await persistEmission(ctx.admin, {
      branchId: ctx.branchId,
      origin,
      model,
      ambiente: ctx.ambiente,
      payload: built.payload,
      document,
      createdBy: ctx.userId,
    });
  } catch (err) {
    // **Desfazer aqui é seguro nos dois desfechos possíveis**, e é o guarda de
    // `releaseEmission` que faz a distinção — ele só toca a linha enquanto ela
    // ainda está em `processando_autorizacao`:
    //
    // - falhou antes ou durante `provider.emit()` (transporte, provedor não
    //   configurado): nada foi emitido, a linha ainda é a reserva, e ela é
    //   desfeita. Sem isso a venda ficaria presa — `decideEmissao` recusa
    //   reemitir por cima de uma reserva, e nada a limparia até A6 existir;
    // - falhou no `persistEmission`: se o cabeçalho **não** entrou, a linha
    //   ainda é a reserva e vale o mesmo raciocínio; se entrou e o que falhou
    //   foi o detalhe (itens/evento — ver o cabeçalho de `persist.ts`), o
    //   status já é o desfecho e as duas escritas de `releaseEmission` não
    //   afetam linha nenhuma. Apagar a chave de uma nota autorizada seria
    //   exatamente a perda que A5 existe para impedir, e o guarda impede.
    await releaseEmission(ctx.admin, reservation);
    throw err;
  }

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

/**
 * **Consultar o provedor pela `ref` e reconciliar a linha com o que ele
 * responder.**
 *
 * Existe desde A1, mas até A6 (09/09/2026) nenhuma tela a chamava — ela estava
 * viva no código e morta no produto. A6 liga o botão "Consultar status" em
 * `InvoicesPage.tsx` e transforma esta função no **único caminho de resolução**
 * de uma nota que ficou presa em `processando_autorizacao`.
 *
 * A regra que a governa não é "libere o que está velho", e sim **"pergunte
 * antes de decidir"**: só o provedor sabe distinguir uma emissão que nunca
 * chegou a ele de uma que ele autorizou e cuja resposta não chegou a ser
 * gravada. Liberar sem perguntar produziria a segunda nota real para a mesma
 * venda que A5 existe para impedir. A tabela inteira mora em `decideConsulta`
 * (`reservation.ts`); aqui fica só o despacho e as duas escritas.
 */
async function handleQuery(ctx: Context, origin: FiscalDocumentOrigin): Promise<Response> {
  const ref = refFor(origin);
  const origem = describeOrigin(origin);
  const existing = await readDocumentByRef(ctx.admin, ref);
  if (!existing) {
    return outcome([`Esta ${origem} não tem nota emitida.`]);
  }
  if (existing.branch_id !== ctx.branchId) {
    return outcome(["A nota não pertence à filial informada."]);
  }

  const { decisao, aplicado } = await reconciliaComProvedor(ctx, existing, origem, {
    createdBy: ctx.userId,
    origemEscrita: "consulta",
  });

  if (decisao.kind === "liberar" && !aplicado) {
    // A emissão original não estava morta, só lenta: ela saiu de
    // `processando_autorizacao` entre a consulta ao provedor e a escrita, e
    // o desfecho dela é o que vale. Qual desfecho, porém, muda a resposta —
    // dizer "concluída" para os três seria mentira em dois deles. Relê a linha
    // e reaproveita a mesma tabela de `handleEmit`, que já sabe traduzir cada
    // estado (inclusive a linha que sumiu porque `releaseEmission` a apagou
    // depois de o `emit()` falhar por transporte).
    const atual = await readDocumentByRef(ctx.admin, ref);
    const resposta = decideAposPerderCorrida(atual, existing.model, origem);
    return outcome(resposta.errors, resposta.extra);
  }

  // `manter`: nada é escrito. É o caso da consulta que só confirma o que já
  // sabíamos, e o das duas divergências que não podem virar escrita — o
  // provedor que não conhece uma nota autorizada, e o que contradiz um
  // cancelamento nosso.
  return outcome(decisao.errors, decisao.extra);
}

/* ------------------------------------------------------------------------ */
/* A varredura agendada (A7, 09/09/2026)                                     */
/* ------------------------------------------------------------------------ */

/**
 * **O tique da fila: resolver, sem humano presente, as reservas que ficaram
 * órfãs.**
 *
 * É a quarta ação da função, e a única que não vem de uma tela. Quem a chama é
 * o `cron.schedule` da migration de A7, a cada 5 minutos, via `net.http_post`.
 *
 * **Ela não decide nada de novo.** Para cada linha presa ela faz o mesmo que o
 * botão "Consultar status" de A6 faz — `reconciliaComProvedor`, ou seja
 * `provider.query(ref)` passado por `decideConsulta`. O que A7 acrescenta é
 * *quando* perguntar (`decideElegibilidade`, em `queue.ts`) e o que fazer quando
 * a própria pergunta falha (o backoff em `fiscal_queue`).
 *
 * ## O que ela deliberadamente não faz
 *
 * **Não emite nem reemite nota nenhuma.** Nenhuma linha em `erro_autorizacao`
 * volta para o provedor por conta desta varredura, e nenhuma venda sem nota vira
 * emissão automática. O porquê de cada uma dessas duas exclusões está no
 * cabeçalho de `queue.ts` e na entrada de A7 no AGENTS.md. O caminho síncrono do
 * clique — "Emitir Nota" e o checkbox da finalização da venda — ficou exatamente
 * como estava.
 *
 * ## Uma falha não derruba o lote
 *
 * Cada linha é tentada dentro do seu próprio `try`. Uma reserva cujo provedor
 * está fora do ar não pode impedir que as outras 24 do lote sejam resolvidas —
 * é o modo de falha mais provável de todos, porque "o provedor está fora" é
 * justamente o que produz reserva órfã em série.
 */
async function handleSweep(ctx: ProviderContext): Promise<Response> {
  const agora = new Date();

  const candidatos = await readStuckReservations(
    ctx.admin,
    corteDeIdade(agora),
    JANELA_CANDIDATOS,
  );
  const fila = await readQueueEntries(
    ctx.admin,
    candidatos.map((row) => row.id),
  );

  const lote = selecionaLote(
    candidatos,
    (row: StuckReservationRow) => {
      const entrada = fila.get(row.id);
      return {
        status: row.status,
        reservadaEm: row.updated_at,
        fila: entrada
          ? { tentativas: entrada.tentativas, proximaTentativaEm: entrada.proxima_tentativa_em }
          : null,
      };
    },
    agora,
  );

  const resumo = {
    candidatos: candidatos.length,
    tentados: lote.length,
    gravados: 0,
    liberados: 0,
    aguardando: 0,
    resolvidosPorOutro: 0,
    falhas: 0,
  };

  for (const row of lote) {
    const origem = row.sale_return_id ? "devolução" : "venda";
    try {
      const { decisao, aplicado } = await reconciliaComProvedor(ctx, row, origem, {
        createdBy: null,
        origemEscrita: "fila",
      });

      if (decisao.kind === "manter") {
        // Sobre uma linha reservada, `manter` só tem um significado possível: o
        // provedor respondeu `processando_autorizacao`, ou seja, a emissão está
        // viva do lado dele (o caso normal de A12). Os outros dois `manter` de
        // `decideConsulta` exigem que o banco diga `autorizado` ou `cancelado`,
        // e uma linha assim não chega até aqui. Não é falha: o provedor falou
        // com a gente, e o contador de tentativas zera.
        await saveQueueEntry(ctx.admin, {
          fiscalDocumentId: row.id,
          ...agendarAposAguardar(new Date()),
          ultimoErro: null,
        });
        resumo.aguardando += 1;
        continue;
      }

      // `gravar` e `liberar` tiram a linha de `processando_autorizacao`; o
      // `liberar` que não aplicou significa que outra requisição a tirou
      // primeiro. Nos três casos não há mais o que perseguir.
      await clearQueueEntry(ctx.admin, row.id);
      if (decisao.kind === "gravar") resumo.gravados += 1;
      else if (aplicado) resumo.liberados += 1;
      else resumo.resolvidosPorOutro += 1;
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : String(err);
      await saveQueueEntry(ctx.admin, {
        fiscalDocumentId: row.id,
        ...agendarAposFalha(fila.get(row.id)?.tentativas ?? 0, new Date()),
        ultimoErro: message,
      });
      resumo.falhas += 1;
      console.error("[fiscal-emit] fila: falha ao resolver a reserva", row.ref, message);
    }
  }

  console.log("[fiscal-emit] fila", JSON.stringify(resumo));
  return jsonResponse({ ok: true, ...resumo });
}

/**
 * A autenticação da varredura, que não pode ser a das outras três ações.
 *
 * `emit`, `cancel` e `query` são atos de um operador: elas exigem um JWT de
 * usuário e passam por `has_permission` e `has_branch_access`, que decidem por
 * `auth.uid()`. A varredura não tem usuário nenhum — e inventar um "usuário de
 * serviço" com permissão fiscal em todas as filiais criaria justamente a conta
 * que A1 fechou.
 *
 * Então ela se autentica por um **segredo próprio**, `FISCAL_QUEUE_SECRET`, no
 * header `x-fiscal-queue-secret`. Ele não substitui o portão do gateway
 * (`verify_jwt = true` continua valendo, e o `cron.schedule` manda a chave
 * anônima no `Authorization` para passar por ele) — ele é o que separa "qualquer
 * um com a chave pública" de "o agendador".
 *
 * **Falha fechado**: sem a variável configurada, a varredura não roda. Uma
 * função implantada antes de o segredo existir responde 503 e o agendador
 * registra o erro em `cron.job_run_details`, em vez de rodar sem porteiro.
 *
 * A comparação em tempo constante e a decisão em si moram em
 * `_shared/http/sharedSecret.ts` desde A8 (09/09/2026), porque `fiscal-webhook`
 * autentica pelo mesmo mecanismo — e uma comparação de segredo é justamente o
 * tipo de código que não pode existir em duas versões que divergem.
 */
function recusaVarredura(req: Request): Response | null {
  const recusa = decideAcessoPorSegredo(
    req.headers.get("x-fiscal-queue-secret"),
    Deno.env.get("FISCAL_QUEUE_SECRET"),
    { porta: "A varredura da fila fiscal", variavel: "FISCAL_QUEUE_SECRET" },
  );
  return recusa ? jsonResponse({ error: recusa.error }, recusa.status) : null;
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

  // **A varredura sai antes de tudo**, e de propósito: ela não tem `branchId`,
  // não tem venda, não tem usuário, e a validação abaixo recusaria as três
  // ausências. Ver `recusaVarredura` para por que a autenticação dela é outra.
  if (action === "sweep") {
    const recusa = recusaVarredura(req);
    if (recusa) return recusa;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const providerId = resolveFiscalProviderId(Deno.env.get("FISCAL_PROVIDER"), (message) =>
      console.warn(message),
    );
    try {
      return await handleSweep({ admin, providerId, ambiente: resolveAmbiente(providerId) });
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : String(err);
      console.error("[fiscal-emit] sweep", message);
      return jsonResponse({ error: message }, 500);
    }
  }

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
