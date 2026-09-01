/**
 * **O que a Edge Function grava depois de falar com o provedor.**
 *
 * As três tabelas do modelo canônico (A3, 01/09/2026):
 *
 * - `fiscal_documents` — o cabeçalho da nota. Upsert por `ref`, que é a chave de
 *   idempotência da emissão.
 * - `fiscal_document_items` — uma linha por item, com o snapshot do produto e o
 *   que foi **declarado** de imposto naquele item.
 * - `fiscal_document_events` — o que aconteceu: autorização, rejeição,
 *   cancelamento.
 *
 * Quem escreve aqui é `service_role`, que não passa por RLS — por isso duas
 * disciplinas que o cliente não precisava ter:
 *
 * 1. **`created_by` vai explícito.** O default da coluna é `auth.uid()`, que
 *    sob `service_role` é nulo; sem passar o id do chamador, toda nota nasceria
 *    órfã de autor. (A3 já anotava esta pegadinha.)
 * 2. **A filial vem da venda, nunca da requisição.** Quem lê é `data.ts`; aqui
 *    ela só é repassada.
 *
 * ## Sobre atomicidade
 *
 * As três escritas são três statements, não uma transação — PostgREST não
 * oferece transação entre tabelas. A ordem é deliberada: **o cabeçalho primeiro**.
 * Ele é o registro de que a nota existe (chave, protocolo, status), o único que
 * não pode ser perdido; itens e eventos são detalhamento. Se uma das escritas
 * seguintes falhar, quem chamou recebe uma mensagem dizendo que a nota **foi
 * autorizada** e que reemitir é seguro — a emissão é idempotente por `ref`, o
 * provedor devolve o mesmo documento e o upsert reescreve tudo. Fingir que a
 * emissão falhou seria pior: ela aconteceu, e a SEFAZ não desfaz por causa de um
 * insert que não passou.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import type {
  FiscalCancelResult,
  FiscalDocument,
  FiscalModel,
  NfePayload,
} from "../_shared/fiscal/types.ts";

/** `fiscal_ambiente` — o enum criado por A3. */
export type FiscalAmbiente = "homologacao" | "producao";

/**
 * A origem do documento — venda ou devolução, nunca as duas (o CHECK
 * `fiscal_documents_one_origin_check` impõe isso no banco). União, e não dois
 * campos opcionais, para "nenhuma das duas" não ser representável.
 */
export type FiscalDocumentOrigin = { saleId: string } | { saleReturnId: string };

/** A linha de `fiscal_documents` que interessa a quem chamou. */
export type FiscalDocumentRow = {
  id: string;
  ref: string;
  branch_id: string;
  model: FiscalModel;
  status: string;
  chave: string | null;
  numero: string | null;
  serie: string | null;
  protocolo: string | null;
  status_sefaz: string | null;
  mensagem_sefaz: string | null;
  xml_content: string | null;
  xml_path: string | null;
  pdf_content: string | null;
  pdf_path: string | null;
  qr_code_url: string | null;
  emitente_cnpj: string | null;
};

const DOCUMENT_COLUMNS =
  "id, ref, branch_id, model, status, chave, numero, serie, protocolo, status_sefaz, mensagem_sefaz, " +
  "xml_content, xml_path, pdf_content, pdf_path, qr_code_url, emitente_cnpj";

/** A nota já gravada para esta `ref`, ou `null` se ainda não existe nenhuma. */
export async function readDocumentByRef(
  admin: SupabaseClient,
  ref: string,
): Promise<FiscalDocumentRow | null> {
  const { data, error } = await admin
    .from("fiscal_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("ref", ref)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as FiscalDocumentRow | null) ?? null;
}

/**
 * O maior número já emitido nesta filial para este modelo.
 *
 * Serve para o provedor simulado continuar a numeração de onde parou, em vez de
 * recomeçar do 1 a cada requisição (ver `seed` em `simulatedFiscalProvider.ts`).
 * **Não é reserva de numeração** — duas emissões simultâneas leem o mesmo
 * máximo e saem com o mesmo número. Numeração atômica por filial e série é a
 * tarefa A10; isto aqui só impede que o passo A1 piore o que já existia (o
 * contador em memória do navegador, que zerava a cada F5).
 *
 * ## Por que a consulta não é ordenada nem limitada
 *
 * A forma óbvia — as N notas mais recentes, e o maior número entre elas — está
 * errada exatamente por causa da história que esta função existe para
 * consertar: até A1 a numeração reiniciava do 1 a cada sessão do navegador, e
 * por isso o banco tem notas antigas com números **maiores** que as recentes
 * (uma sessão longa foi até 50; dez sessões curtas depois dela ficaram em 1–5).
 * Uma janela das mais recentes devolveria 5, e a numeração seguinte colidiria
 * com as notas 6 a 50. E ordenar por `numero` no banco também não resolve: a
 * coluna é `text` (o provedor real devolve string), então "9" ordenaria acima
 * de "10". Sobra ler a coluna inteira — uma coluna curta, só para o provedor
 * simulado — e tirar o máximo aqui.
 */
export async function readLastNumero(
  admin: SupabaseClient,
  branchId: string,
  model: FiscalModel,
): Promise<number> {
  const { data, error } = await admin
    .from("fiscal_documents")
    .select("numero")
    .eq("branch_id", branchId)
    .eq("model", model)
    .not("numero", "is", null);
  if (error) throw error;

  let maior = 0;
  for (const row of (data ?? []) as unknown as { numero: string | null }[]) {
    const numero = Number(row.numero);
    if (Number.isInteger(numero) && numero > maior) maior = numero;
  }
  return maior;
}

function toNumberOrNull(value: number | undefined): number | null {
  return value === undefined ? null : value;
}

/**
 * `NfePayload` → colunas de cabeçalho de `fiscal_documents`.
 *
 * O payload é o que foi efetivamente declarado ao provedor, então ele — e não a
 * venda — é a fonte deste snapshot: é isso que faz a nota parar de mudar
 * retroativamente quando o cadastro do cliente ou da filial muda (A3).
 */
function headerFromPayload(payload: NfePayload): Record<string, unknown> {
  return {
    data_emissao: payload.data_emissao,
    natureza_operacao: payload.natureza_operacao,
    tipo_documento: payload.tipo_documento,
    finalidade: payload.finalidade_emissao,
    consumidor_final: payload.consumidor_final === undefined ? null : payload.consumidor_final === 1,
    indicador_presenca: toNumberOrNull(payload.presenca_comprador),
    local_destino: toNumberOrNull(payload.local_destino),
    modalidade_frete: toNumberOrNull(payload.modalidade_frete),
    chave_referenciada: payload.notas_referenciadas?.[0]?.chave_nfe ?? null,

    emitente_cnpj: payload.cnpj_emitente,
    emitente_nome: payload.nome_emitente,
    emitente_nome_fantasia: payload.nome_fantasia_emitente ?? null,
    emitente_inscricao_estadual: payload.inscricao_estadual_emitente ?? null,
    emitente_regime_tributario:
      payload.regime_tributario_emitente === undefined
        ? null
        : String(payload.regime_tributario_emitente),
    emitente_logradouro: payload.logradouro_emitente ?? null,
    emitente_numero: payload.numero_emitente ?? null,
    emitente_bairro: payload.bairro_emitente ?? null,
    emitente_municipio: payload.municipio_emitente ?? null,
    emitente_uf: payload.uf_emitente ?? null,
    emitente_cep: payload.cep_emitente ?? null,

    destinatario_nome: payload.nome_destinatario ?? null,
    destinatario_cnpj: payload.cnpj_destinatario ?? null,
    destinatario_cpf: payload.cpf_destinatario ?? null,
    destinatario_inscricao_estadual: payload.inscricao_estadual_destinatario ?? null,
    destinatario_indicador_ie:
      payload.indicador_inscricao_estadual_destinatario === undefined
        ? null
        : String(payload.indicador_inscricao_estadual_destinatario),
    destinatario_logradouro: payload.logradouro_destinatario ?? null,
    destinatario_numero: payload.numero_destinatario ?? null,
    destinatario_bairro: payload.bairro_destinatario ?? null,
    destinatario_municipio: payload.municipio_destinatario ?? null,
    destinatario_uf: payload.uf_destinatario ?? null,
    destinatario_cep: payload.cep_destinatario ?? null,
    destinatario_pais: payload.pais_destinatario ?? null,
    destinatario_telefone: payload.telefone_destinatario ?? null,

    total_produtos: payload.valor_produtos,
    total_desconto: toNumberOrNull(payload.valor_desconto),
    total_frete: toNumberOrNull(payload.valor_frete),
    total_seguro: toNumberOrNull(payload.valor_seguro),
    total_outras_despesas: toNumberOrNull(payload.valor_outras_despesas),
    total_nota: payload.valor_total,
    total_icms_base: toNumberOrNull(payload.icms_base_calculo),
    total_icms: toNumberOrNull(payload.icms_valor_total),
    total_ipi: toNumberOrNull(payload.valor_ipi),
    total_pis: toNumberOrNull(payload.valor_pis),
    total_cofins: toNumberOrNull(payload.valor_cofins),
    // ICMS-ST, FCP, IBS e CBS ficam nulos: o mapeamento de hoje não os calcula,
    // e nulo em `total_*` significa "não calculado", nunca zero (A3). Quem os
    // preenche é o motor tributário da Etapa 2.
    total_icms_st_base: null,
    total_icms_st: null,
    total_fcp: null,
    total_ibs: null,
    total_cbs: null,

    informacoes_adicionais: payload.informacoes_adicionais_contribuinte ?? null,
  };
}

/**
 * `NfePayloadItem[]` → linhas de `fiscal_document_items`.
 *
 * Grava **o que foi declarado**, não uma segunda opinião sobre a tributação: as
 * colunas de ICMS/PIS/COFINS recebem exatamente os valores que foram para o
 * XML, e ficam nulas onde o mapeamento de hoje não calcula nada (ICMS-ST, FCP,
 * IPI, IBS, CBS e as reduções de base). Fosse o contrário — modelo em branco e
 * XML com imposto —, as duas metades de A3 contariam histórias diferentes sobre
 * a mesma nota.
 */
function itemsFromPayload(fiscalDocumentId: string, payload: NfePayload): Record<string, unknown>[] {
  return payload.items.map((item) => ({
    fiscal_document_id: fiscalDocumentId,
    numero_item: item.numero_item,
    // Sem `product_id`: o `NfePayload` identifica o produto pelo código (é o que
    // vai no XML), não pelo uuid. A coluna é rastro opcional (`on delete set
    // null`) e quem a preencher precisa carregar o id item a item — trabalho de
    // quem for ligar a ficha do item à ficha do produto, não desta tarefa.
    codigo_produto: item.codigo_produto,
    descricao: item.descricao,
    ncm: item.codigo_ncm,
    cest: item.codigo_cest ?? null,
    cfop: item.cfop,
    origem_mercadoria: item.icms_origem || null,
    unidade_comercial: item.unidade_comercial ?? null,
    unidade_tributavel: item.unidade_tributavel ?? null,

    quantidade_comercial: item.quantidade_comercial,
    valor_unitario_comercial: item.valor_unitario_comercial,
    quantidade_tributavel: toNumberOrNull(item.quantidade_tributavel),
    valor_unitario_tributavel: toNumberOrNull(item.valor_unitario_tributavel),
    valor_bruto: item.valor_bruto,
    valor_desconto: item.valor_desconto ?? 0,
    valor_frete: item.valor_frete ?? 0,
    inclui_no_total: item.inclui_no_total !== 0,

    icms_situacao_tributaria: item.icms_situacao_tributaria || null,
    icms_modalidade_base_calculo: item.icms_modalidade_base_calculo ?? null,
    icms_base: toNumberOrNull(item.icms_base_calculo),
    icms_aliquota: toNumberOrNull(item.icms_aliquota),
    icms_valor: toNumberOrNull(item.icms_valor),

    pis_situacao_tributaria: item.pis_situacao_tributaria ?? null,
    pis_base: toNumberOrNull(item.pis_base_calculo),
    pis_aliquota: toNumberOrNull(item.pis_aliquota_porcentual),
    pis_valor: toNumberOrNull(item.pis_valor),

    cofins_situacao_tributaria: item.cofins_situacao_tributaria ?? null,
    cofins_base: toNumberOrNull(item.cofins_base_calculo),
    cofins_aliquota: toNumberOrNull(item.cofins_aliquota_porcentual),
    cofins_valor: toNumberOrNull(item.cofins_valor),

    ipi_situacao_tributaria: item.ipi_situacao_tributaria ?? null,
    ipi_base: toNumberOrNull(item.ipi_base_calculo),
    ipi_aliquota: toNumberOrNull(item.ipi_aliquota),
    ipi_valor: toNumberOrNull(item.ipi_valor),
  }));
}

/**
 * O documento devolvido pelo provedor, pronto para `response_payload` (jsonb).
 *
 * O conteúdo dos artefatos é substituído pelo tamanho: o XML já é gravado em
 * `fiscal_documents.xml_content`, e repeti-lo dentro do jsonb do evento
 * dobraria o armazenamento de cada nota sem responder nenhuma pergunta nova.
 * O que a auditoria precisa saber é se o artefato veio, e por qual caminho.
 */
function artifactSummary(document: FiscalDocument | FiscalCancelResult): Record<string, unknown> {
  const summarize = (artifact: { content: string | null; path: string | null } | null) =>
    artifact ? { bytes: artifact.content?.length ?? null, path: artifact.path } : null;

  const base: Record<string, unknown> = { ...document };
  if ("xml" in document) base.xml = summarize(document.xml);
  if ("pdf" in document) base.pdf = summarize(document.pdf);
  base.xmlCancelamento = summarize(document.xmlCancelamento);
  return base;
}

export type PersistEmissionInput = {
  branchId: string;
  origin: FiscalDocumentOrigin;
  model: FiscalModel;
  ambiente: FiscalAmbiente;
  payload: NfePayload;
  document: FiscalDocument;
  /** O usuário que pediu a emissão — explícito porque `auth.uid()` é nulo aqui. */
  createdBy: string;
};

/**
 * Grava o resultado de `FiscalProvider.emit()` nas três tabelas.
 *
 * Devolve a linha de `fiscal_documents`. Lança quando a gravação falha — ver a
 * seção sobre atomicidade no cabeçalho.
 */
export async function persistEmission(
  admin: SupabaseClient,
  input: PersistEmissionInput,
): Promise<FiscalDocumentRow> {
  const { branchId, origin, model, ambiente, payload, document, createdBy } = input;

  if (document.status === "nao_encontrado") {
    // `nao_encontrado` é resultado de consulta, nunca algo que emit() devolve —
    // narrow defensivo para bater com o enum `fiscal_document_status`.
    throw new Error("Estado inesperado: emit() devolveu nao_encontrado.");
  }

  const { data: saved, error: documentError } = await admin
    .from("fiscal_documents")
    .upsert(
      {
        branch_id: branchId,
        sale_id: "saleId" in origin ? origin.saleId : null,
        sale_return_id: "saleReturnId" in origin ? origin.saleReturnId : null,
        model,
        ref: document.ref,
        status: document.status,
        ambiente,
        chave: document.chave,
        numero: document.numero,
        serie: document.serie,
        protocolo: document.protocolo,
        status_sefaz: document.statusSefaz,
        mensagem_sefaz: document.mensagemSefaz,
        xml_content: document.xml?.content ?? null,
        xml_path: document.xml?.path ?? null,
        pdf_content: document.pdf?.content ?? null,
        pdf_path: document.pdf?.path ?? null,
        qr_code_url: document.qrCodeUrl,
        created_by: createdBy,
        updated_at: new Date().toISOString(),
        ...headerFromPayload(payload),
      },
      { onConflict: "ref" },
    )
    .select(DOCUMENT_COLUMNS)
    .single();
  if (documentError) throw documentError;
  const row = saved as unknown as FiscalDocumentRow;

  const autorizada = document.status === "autorizado";
  const detailError = await persistEmissionDetail(admin, {
    row,
    branchId,
    ambiente,
    payload,
    document,
    createdBy,
  });
  if (detailError) {
    throw new Error(
      autorizada
        ? `A nota foi autorizada (chave ${document.chave ?? "—"}), mas houve falha ao gravar o detalhe ` +
          `dela: ${detailError}. Emitir de novo é seguro — a emissão é idempotente e reescreve o registro.`
        : `Falha ao gravar o detalhe do documento fiscal: ${detailError}`,
    );
  }

  return row;
}

/**
 * Itens e evento. Separado de `persistEmission` para deixar explícito o que é o
 * registro da nota (o cabeçalho, acima) e o que é detalhamento dela — a ordem
 * entre os dois é o que protege a informação que não pode se perder.
 */
async function persistEmissionDetail(
  admin: SupabaseClient,
  input: {
    row: FiscalDocumentRow;
    branchId: string;
    ambiente: FiscalAmbiente;
    payload: NfePayload;
    document: FiscalDocument;
    createdBy: string;
  },
): Promise<string | null> {
  const { row, branchId, ambiente, payload, document, createdBy } = input;

  // Reemissão (a anterior tinha sido recusada) reescreve os itens: a nota que
  // vale é a que acabou de sair, e `(fiscal_document_id, numero_item)` é único.
  const { error: clearError } = await admin
    .from("fiscal_document_items")
    .delete()
    .eq("fiscal_document_id", row.id);
  if (clearError) return clearError.message;

  const items = itemsFromPayload(row.id, payload);
  if (items.length > 0) {
    const { error: itemsError } = await admin.from("fiscal_document_items").insert(items);
    if (itemsError) return itemsError.message;
  }

  // `processando_autorizacao` não gera evento: nada aconteceu ainda. Os dois
  // desfechos que a SEFAZ dá — autorizou ou recusou — geram.
  const tipo =
    document.status === "autorizado"
      ? "autorizacao"
      : document.status === "erro_autorizacao" || document.status === "denegado"
        ? "rejeicao"
        : null;
  if (!tipo) return null;

  const { error: eventError } = await admin.from("fiscal_document_events").insert({
    branch_id: branchId,
    fiscal_document_id: row.id,
    tipo,
    ambiente,
    status_sefaz: document.statusSefaz,
    mensagem_sefaz: document.mensagemSefaz,
    protocolo: document.protocolo,
    request_payload: payload,
    response_payload: artifactSummary(document),
    // O XML da nota já está em `fiscal_documents.xml_content`; o evento de
    // autorização não tem XML próprio (ao contrário do cancelamento).
    xml_content: null,
    xml_path: null,
    created_by: createdBy,
  });
  if (eventError) return eventError.message;

  return null;
}

export type PersistCancelInput = {
  documentId: string;
  branchId: string;
  ambiente: FiscalAmbiente;
  result: FiscalCancelResult;
  justificativa: string;
  createdBy: string;
};

/**
 * Grava um cancelamento **bem-sucedido**: muda o status do documento e registra
 * o evento.
 *
 * Recusa (`erro_cancelamento`) e `nao_encontrado` não gravam nada — a recusa é
 * do evento de cancelamento, não uma mudança de status do documento, que
 * continua autorizado. Quem chama mostra `mensagemSefaz` e segue.
 *
 * As colunas `cancel_xml_content` / `cancel_xml_path` / `cancel_justificativa`
 * de `fiscal_documents` **não são mais escritas**: o cancelamento passou a ser
 * uma linha de `fiscal_document_events` (A3), e a migration que as remove é
 * parte desta tarefa.
 */
export async function persistCancel(admin: SupabaseClient, input: PersistCancelInput): Promise<void> {
  const { documentId, branchId, ambiente, result, justificativa, createdBy } = input;

  const { error: documentError } = await admin
    .from("fiscal_documents")
    .update({
      status: "cancelado",
      status_sefaz: result.statusSefaz,
      mensagem_sefaz: result.mensagemSefaz,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);
  if (documentError) throw documentError;

  const { error: eventError } = await admin.from("fiscal_document_events").insert({
    branch_id: branchId,
    fiscal_document_id: documentId,
    tipo: "cancelamento",
    ambiente,
    status_sefaz: result.statusSefaz,
    mensagem_sefaz: result.mensagemSefaz,
    justificativa,
    request_payload: { ref: result.ref, justificativa },
    response_payload: artifactSummary(result),
    xml_content: result.xmlCancelamento?.content ?? null,
    xml_path: result.xmlCancelamento?.path ?? null,
    created_by: createdBy,
  });
  if (eventError) {
    throw new Error(
      `A nota foi cancelada, mas houve falha ao gravar o evento de cancelamento: ${eventError.message}`,
    );
  }
}

/** Atualiza o status de um documento a partir de uma consulta ao provedor. */
export async function persistQueryStatus(
  admin: SupabaseClient,
  documentId: string,
  document: FiscalDocument,
): Promise<void> {
  const { error } = await admin
    .from("fiscal_documents")
    .update({
      status: document.status,
      chave: document.chave,
      numero: document.numero,
      serie: document.serie,
      protocolo: document.protocolo,
      status_sefaz: document.statusSefaz,
      mensagem_sefaz: document.mensagemSefaz,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);
  if (error) throw error;
}
