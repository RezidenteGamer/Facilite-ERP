/**
 * **O que a Edge Function grava depois de falar com o provedor.**
 *
 * As três tabelas do modelo canônico (A3, 01/09/2026):
 *
 * - `fiscal_documents` — o cabeçalho da nota. Upsert por `ref`, que é a chave de
 *   idempotência da emissão. Desde A5 (07/09/2026) esse upsert **sempre** cai
 *   numa linha que a própria requisição reservou (`reserveEmission`, abaixo):
 *   `onConflict: "ref"` sobrescreve em vez de falhar, e sem a reserva duas
 *   emissões concorrentes da mesma venda gravavam uma por cima da outra — a
 *   segunda apagando a chave de acesso da primeira. Ver `reservation.ts`.
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

import { RESERVA_STATUS, STATUS_APOS_LIBERAR, isViolacaoDeUnicidade } from "./reservation.ts";

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

/* ------------------------------------------------------------------------ */
/* A reserva atômica da emissão (A5, 07/09/2026)                             */
/* ------------------------------------------------------------------------ */

/**
 * O resultado da tentativa de reservar a emissão desta `ref`.
 *
 * `previousStatus` é o que a linha tinha **antes** da reserva: `null` quando a
 * linha foi criada agora (não existia nota nenhuma), e o status anterior quando
 * a reserva foi tomada de uma nota recusada que está sendo reemitida. É o que
 * `releaseEmission` precisa para desfazer sem inventar estado.
 */
export type EmissionReservation =
  | { reserved: true; documentId: string; previousStatus: string | null }
  | { reserved: false };

export type ReserveEmissionInput = {
  ref: string;
  branchId: string;
  origin: FiscalDocumentOrigin;
  model: FiscalModel;
  ambiente: FiscalAmbiente;
  createdBy: string;
  /** A linha lida no início de `handleEmit`, ou `null` se ainda não havia nenhuma. */
  existing: FiscalDocumentRow | null;
};

/**
 * **Trava a emissão desta `ref` no banco, antes de qualquer chamada ao
 * provedor** — ver o cabeçalho de `reservation.ts` para a corrida que isto
 * fecha.
 *
 * Dois caminhos, os dois atômicos em um único statement:
 *
 * - **Não havia linha**: `insert`. Quem perde esbarra em `fiscal_documents_ref_key`
 *   (ou num dos índices parciais por origem + modelo) e recebe `23505`.
 * - **Havia linha recusada** (`erro_autorizacao` / `denegado`, o caminho de
 *   reemissão): `update ... where id = ? and status = ?` — um compare-and-swap
 *   sobre o status que acabou de ser lido. Sob `read committed`, a segunda
 *   requisição espera o lock da primeira e **reavalia** o `where` depois dela:
 *   encontra `processando_autorizacao`, não `erro_autorizacao`, e não afeta
 *   linha nenhuma. É a mesma garantia que o `select ... for update` de C4 dá
 *   para o estoque, escrita como CAS porque aqui não há transação para
 *   segurar o lock entre dois statements (o PostgREST não oferece uma).
 *
 * Não reserva por cima de `processando_autorizacao`: essa é a reserva de outra
 * requisição, e `decideEmissao` já responde "em andamento" antes de chegar
 * aqui. A checagem repetida é defesa em profundidade — quem tomar a reserva de
 * quem está emitindo produz exatamente a segunda nota que isto evita.
 */
export async function reserveEmission(
  admin: SupabaseClient,
  input: ReserveEmissionInput,
): Promise<EmissionReservation> {
  const { ref, branchId, origin, model, ambiente, createdBy, existing } = input;

  if (existing?.status === RESERVA_STATUS) return { reserved: false };

  if (!existing) {
    const { data, error } = await admin
      .from("fiscal_documents")
      .insert({
        branch_id: branchId,
        sale_id: "saleId" in origin ? origin.saleId : null,
        sale_return_id: "saleReturnId" in origin ? origin.saleReturnId : null,
        model,
        ref,
        status: RESERVA_STATUS,
        ambiente,
        created_by: createdBy,
      })
      .select("id")
      .single();
    if (error) {
      if (isViolacaoDeUnicidade(error)) return { reserved: false };
      throw error;
    }
    return { reserved: true, documentId: (data as { id: string }).id, previousStatus: null };
  }

  const { data, error } = await admin
    .from("fiscal_documents")
    .update({ status: RESERVA_STATUS, updated_at: new Date().toISOString() })
    .eq("id", existing.id)
    .eq("status", existing.status)
    .select("id");
  if (error) throw error;
  if (!data || (data as unknown[]).length === 0) return { reserved: false };
  return { reserved: true, documentId: existing.id, previousStatus: existing.status };
}

/**
 * Desfaz uma reserva que não virou nota — a chamada ao provedor falhou por
 * transporte, e nenhum documento foi emitido.
 *
 * Sem isto, `processando_autorizacao` ficaria pendurado e a venda não poderia
 * mais ser emitida: `decideEmissao` recusa reemitir por cima da reserva de
 * outra requisição, e ela não teria como saber que o "outro" morreu. Manter a
 * reserva viva além da requisição é justamente o problema que A6 vai tratar (o
 * provedor real responde 202 e autoriza depois); enquanto A6 não existe, A5
 * garante o invariante mais simples: **`processando_autorizacao` não
 * sobrevive à requisição HTTP que o escreveu**.
 *
 * As duas escritas são condicionadas a `status = 'processando_autorizacao'`
 * para nunca desfazerem um desfecho que outra requisição já gravou.
 *
 * **Nunca lança.** Ela roda no caminho de erro, e uma falha aqui não pode
 * substituir a exceção original — que é a que diz o que de fato deu errado.
 */
export async function releaseEmission(
  admin: SupabaseClient,
  reservation: Extract<EmissionReservation, { reserved: true }>,
): Promise<void> {
  const { documentId, previousStatus } = reservation;
  try {
    if (previousStatus === null) {
      const { error } = await admin
        .from("fiscal_documents")
        .delete()
        .eq("id", documentId)
        .eq("status", RESERVA_STATUS);
      if (error) throw error;
      return;
    }
    const { error } = await admin
      .from("fiscal_documents")
      .update({ status: previousStatus, updated_at: new Date().toISOString() })
      .eq("id", documentId)
      .eq("status", RESERVA_STATUS);
    if (error) throw error;
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : String(err);
    console.error("[fiscal-emit] falha ao desfazer a reserva de emissão", documentId, message);
  }
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
 * Soma duas alíquotas em percentual, devolvendo `null` quando **nenhuma** das
 * duas foi declarada (B10).
 *
 * Existe para uma coisa só: `fiscal_document_items.ibs_aliquota` é uma coluna
 * e o XML tem duas alíquotas de IBS (`pIBSUF` e `pIBSMun`). Somar mantém a
 * identidade `base × alíquota / 100 = valor` dentro da linha gravada. Uma das
 * duas ausente conta como zero — o que não pode acontecer é a soma virar `0`
 * num item que não declarou IBS nenhum, e é isso que o `null` evita.
 */
function somaDeAliquotas(a: number | undefined, b: number | undefined): number | null {
  if (a === undefined && b === undefined) return null;
  // Arredondado a quatro casas, que é a precisão da coluna (`numeric(7,4)`) e a
  // mesma da `pAliqEfet` no XML: somar dois números de ponto flutuante pode
  // devolver `0.08000000000000002` onde o certo é `0.08`.
  return Math.round(((a ?? 0) + (b ?? 0)) * 10000) / 10000;
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
    // ICMS-ST e FCP passaram a ser calculados em B2 (01/09/2026) e deixaram de
    // ser `null` fixo. Continuam nulos quando nenhum item da nota tem ST — e
    // nulo em `total_*` significa "não calculado", nunca zero (A3).
    total_icms_st_base: toNumberOrNull(payload.icms_base_calculo_st),
    total_icms_st: toNumberOrNull(payload.icms_valor_total_st),
    // `total_fcp` recebe o FCP **retido por ST** (`vFCPST`). O FCP da operação
    // própria — que B2 não calculava — passou a existir em B4 (04/09/2026) e
    // tem coluna própria, `total_fcp_uf_destino`: são impostos diferentes em
    // tags diferentes do XML, e somá-los numa coluna só perderia a distinção
    // que uma fiscalização pediria.
    total_fcp: toNumberOrNull(payload.fcp_valor_total_st),
    // DIFAL da EC 87/2015 (B4): colunas novas. Nulas em toda nota que não é
    // venda interestadual a consumidor final não contribuinte — e nulo
    // continua sendo "não calculado" (A3). `total_icms_uf_remetente` é o único
    // total deste motor que sai **zero e não nulo** quando existe: a partilha
    // com a origem acabou em 2019, mas o campo continua no leiaute.
    total_icms_uf_destino: toNumberOrNull(payload.icms_valor_total_uf_destino),
    total_icms_uf_remetente: toNumberOrNull(payload.icms_valor_total_uf_remetente),
    total_fcp_uf_destino: toNumberOrNull(payload.fcp_valor_total_uf_destino),
    // `vTotTrib` da Lei da Transparência (B9, 05/09/2026): coluna nova. Nula
    // em toda nota que não é venda ao consumidor, e em toda venda cujos NCM
    // ainda não têm linha em `ibpt_rates` — e nulo aqui continua sendo "não
    // calculado" (A3), que é exatamente o significado certo: o campo também
    // não foi para o XML.
    total_tributos_aproximados: toNumberOrNull(payload.valor_total_tributos),
    // IBS e CBS (B10, 05/09/2026): as duas colunas existem desde A3 e só agora
    // têm quem as preencha. Guardam o `vIBS` e o `vCBS` do grupo `IBSCBSTot`,
    // e ficam nulas na nota de emitente optante pelo Simples Nacional (que só
    // declara IBS/CBS a partir de 2027) — nulo continua sendo "não calculado".
    //
    // A base compartilhada (`vBCIBSCBS`) e o desdobramento do IBS entre estado
    // e município (`vIBSUF`/`vIBSMun`) **não têm coluna** em `fiscal_documents`
    // e não ganharam uma: os dois são recuperáveis somando os itens, e A3
    // deliberadamente não criou um total para cada campo do XML. Ver a entrada
    // de B10 no AGENTS.md.
    total_ibs: toNumberOrNull(payload.ibs_valor_total),
    total_cbs: toNumberOrNull(payload.cbs_valor_total),

    informacoes_adicionais: payload.informacoes_adicionais_contribuinte ?? null,
  };
}

/**
 * `NfePayloadItem[]` → linhas de `fiscal_document_items`.
 *
 * Grava **o que foi declarado**, não uma segunda opinião sobre a tributação: as
 * colunas recebem exatamente os valores que foram para o XML, e ficam nulas
 * onde o mapeamento não calcula nada. Fosse o contrário — modelo em branco e
 * XML com imposto —, as duas metades de A3 contariam histórias diferentes sobre
 * a mesma nota.
 *
 * A lista do que fica nulo encolheu quatro vezes: B1 (01/09/2026) passou a
 * preencher IPI e `icms_reducao_base`, B2 (mesmo dia) o ICMS-ST e o FCP, B8
 * (03/09/2026) o crédito de ICMS do Simples e B10 (05/09/2026) o IBS e a CBS.
 * Restam `ipi_codigo_enquadramento` (dado de cadastro que ninguém tem) e
 * `icms_st_reducao_base`.
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
    cest: item.cest ?? null,
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
    // `pRedBC` (B1): a coluna existe desde A3 e só agora tem quem a preencha.
    icms_reducao_base: toNumberOrNull(item.icms_reducao_base_calculo),
    icms_aliquota: toNumberOrNull(item.icms_aliquota),
    icms_valor: toNumberOrNull(item.icms_valor),

    // ICMS-ST e FCP-ST (B2): as seis colunas de ST e as três de FCP existem
    // desde A3 e só agora têm quem as preencha. `icms_st_reducao_base`
    // (`pRedBCST`) continua fora — ver a entrada de B2 no AGENTS.md.
    icms_st_modalidade_base_calculo: item.icms_modalidade_base_calculo_st ?? null,
    icms_st_mva: toNumberOrNull(item.icms_margem_valor_adicionado_st),
    icms_st_base: toNumberOrNull(item.icms_base_calculo_st),
    icms_st_reducao_base: toNumberOrNull(item.icms_reducao_base_calculo_st),
    icms_st_aliquota: toNumberOrNull(item.icms_aliquota_st),
    icms_st_valor: toNumberOrNull(item.icms_valor_st),

    // As colunas `fcp_*` guardam o FCP **retido por ST** — o único que o
    // mapeamento calcula. Ver `total_fcp` em `headerFromPayload`.
    fcp_base: toNumberOrNull(item.fcp_base_calculo_st),
    fcp_aliquota: toNumberOrNull(item.fcp_percentual_st),
    fcp_valor: toNumberOrNull(item.fcp_valor_st),

    // Crédito de ICMS do Simples Nacional (B8): colunas novas, ao contrário das
    // de ST — não havia onde guardar `pCredSN`/`vCredICMSSN`. Nulas em todo item
    // que não é CSOSN 101/201, e nulo continua sendo "não calculado" (A3).
    icms_aliquota_credito_simples: toNumberOrNull(item.icms_aliquota_credito_simples),
    icms_valor_credito_simples: toNumberOrNull(item.icms_valor_credito_simples),

    // DIFAL da EC 87/2015 — o grupo `ICMSUFDest` (B4, 04/09/2026). Nove
    // colunas novas: nenhuma existia, porque nenhuma tarefa anterior declarava
    // partilha de ICMS com a UF de destino. Nulas em todo item que não é venda
    // interestadual a consumidor final não contribuinte. As duas alíquotas
    // ficam gravadas junto dos valores pelo mesmo motivo de B8: a interna do
    // destino é uma aproximação do cadastro de hoje (`tax_groups.aliquota_icms`)
    // e a nota tem de continuar dizendo com que número ela calculou.
    icms_uf_destino_base: toNumberOrNull(item.icms_base_calculo_uf_destino),
    icms_uf_destino_aliquota_interna: toNumberOrNull(item.icms_aliquota_interna_uf_destino),
    icms_uf_destino_aliquota_interestadual: toNumberOrNull(item.icms_aliquota_interestadual),
    icms_uf_destino_percentual_partilha: toNumberOrNull(item.icms_percentual_partilha),
    icms_uf_destino_valor: toNumberOrNull(item.icms_valor_uf_destino),
    icms_uf_remetente_valor: toNumberOrNull(item.icms_valor_uf_remetente),
    fcp_uf_destino_base: toNumberOrNull(item.fcp_base_calculo_uf_destino),
    fcp_uf_destino_aliquota: toNumberOrNull(item.fcp_percentual_uf_destino),
    fcp_uf_destino_valor: toNumberOrNull(item.fcp_valor_uf_destino),

    // `*_quantidade_vendida` e `*_aliquota_valor` (B5) são o caminho **por
    // unidade de medida** (CST 03, grupo `PISQtde`); `*_base` e `*_aliquota`
    // são o percentual. Nunca os quatro na mesma linha — quem escolhe é o CST,
    // em `resolvePisCofins`. O par que não vale fica nulo, que é "não
    // calculado", a convenção que A3 fixou para esta tabela.
    pis_situacao_tributaria: item.pis_situacao_tributaria ?? null,
    pis_base: toNumberOrNull(item.pis_base_calculo),
    pis_aliquota: toNumberOrNull(item.pis_aliquota_porcentual),
    pis_quantidade_vendida: toNumberOrNull(item.pis_quantidade_vendida),
    pis_aliquota_valor: toNumberOrNull(item.pis_aliquota_valor),
    pis_valor: toNumberOrNull(item.pis_valor),

    cofins_situacao_tributaria: item.cofins_situacao_tributaria ?? null,
    cofins_base: toNumberOrNull(item.cofins_base_calculo),
    cofins_aliquota: toNumberOrNull(item.cofins_aliquota_porcentual),
    cofins_quantidade_vendida: toNumberOrNull(item.cofins_quantidade_vendida),
    cofins_aliquota_valor: toNumberOrNull(item.cofins_aliquota_valor),
    cofins_valor: toNumberOrNull(item.cofins_valor),

    ipi_situacao_tributaria: item.ipi_situacao_tributaria ?? null,
    ipi_base: toNumberOrNull(item.ipi_base_calculo),
    ipi_aliquota: toNumberOrNull(item.ipi_aliquota),
    ipi_valor: toNumberOrNull(item.ipi_valor),

    // `vTotTrib` do item (B9): coluna nova, e a única deste `insert` que não
    // guarda imposto nenhum — é a estimativa informativa da Lei 12.741/2012.
    // Nula quando o NCM não tem linha em `ibpt_rates`, que é o estado normal de
    // quem ainda não cadastrou os percentuais, não erro.
    valor_tributos_aproximados: toNumberOrNull(item.valor_total_tributos),

    // IBS e CBS (B10): as oito colunas existem desde A3 e só agora têm quem as
    // preencha. Nulas em toda nota que não declara IBS/CBS, e também nos itens
    // cujo CST admite só os dois códigos (isenção `400`, imunidade `410`) — ali
    // o XML não tem `gIBSCBS` e não haveria valor a guardar.
    ibs_cbs_situacao_tributaria: item.ibs_cbs_situacao_tributaria ?? null,
    cclasstrib: item.ibs_cbs_classificacao_tributaria ?? null,
    // A base é **uma só** no XML (`gIBSCBS/vBC`, compartilhada pelos dois
    // tributos) e são duas colunas aqui, herdadas de A3. As duas recebem o
    // mesmo número, de propósito: preencher uma e deixar a outra nula faria a
    // linha parecer meia calculada.
    ibs_base: toNumberOrNull(item.ibs_cbs_base_calculo),
    // A alíquota gravada é a **soma das duas parcelas efetivamente aplicadas**
    // (estadual + municipal), para `ibs_base × ibs_aliquota / 100` reencontrar
    // o `ibs_valor` da mesma linha. O XML tem `pIBSUF` e `pIBSMun` separados e
    // esta tabela não — limitação registrada na entrada de B10 do AGENTS.md.
    // Em 2026 a municipal é zero, então a soma é a própria estadual.
    ibs_aliquota: somaDeAliquotas(item.ibs_uf_aliquota_efetiva ?? item.ibs_uf_aliquota,
      item.ibs_mun_aliquota_efetiva ?? item.ibs_mun_aliquota),
    ibs_valor: toNumberOrNull(item.ibs_valor_total),
    cbs_base: toNumberOrNull(item.ibs_cbs_base_calculo),
    cbs_aliquota: toNumberOrNull(item.cbs_aliquota_efetiva ?? item.cbs_aliquota),
    cbs_valor: toNumberOrNull(item.cbs_valor),
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

/**
 * Quem pediu a reconciliação: o operador que clicou "Consultar status" (A6) ou
 * a varredura agendada (A7).
 *
 * Vai para `fiscal_document_events.request_payload`. Sem isto, uma transição
 * feita pela fila — que roda **sem usuário**, e portanto grava `created_by`
 * nulo — ficaria indistinguível de um evento cujo autor se perdeu. Numa tabela
 * que existe para auditoria fiscal, "mudou sozinho" e "mudou pela varredura das
 * 03h" não podem ter o mesmo registro.
 */
export type OrigemReconciliacao = "consulta" | "fila";

export type PersistQueryStatusInput = {
  documentId: string;
  branchId: string;
  ambiente: FiscalAmbiente;
  document: FiscalDocument;
  /** O status que a linha tinha antes desta escrita — decide se há evento a registrar. */
  previousStatus: string;
  /**
   * Nulo quando quem escreve é a varredura de A7: ela não tem usuário, e
   * `fiscal_document_events.created_by` é nulável de propósito (o default
   * `auth.uid()` já era nulo sob `service_role`). Quem identifica a origem é
   * `origem`, não este campo.
   */
  createdBy: string | null;
  origem?: OrigemReconciliacao;
};

/**
 * Atualiza um documento a partir de uma consulta ao provedor.
 *
 * ## Os artefatos entram, mas nunca apagam (A6, 09/09/2026)
 *
 * Até A6 esta função gravava só as sete colunas de estado, e isso bastava
 * enquanto o único caso era reperguntar por uma nota que `persistEmission` já
 * tinha gravado inteira. A6 criou o caso em que **a consulta é a primeira
 * escrita do desfecho**: o isolate morreu depois de `provider.emit()` e antes de
 * `persistEmission`, e a linha era só a reserva. Sem os artefatos, a
 * recuperação produzia uma nota "Autorizado" com chave e com "Visualizar" e
 * "Gerar XML" desabilitados para sempre — apesar de a resposta da consulta
 * trazer os dois (`toDocument` no simulado, `caminho_xml_nota_fiscal` /
 * `caminho_danfe` na Focus).
 *
 * Eles entram **coalescidos**: uma consulta que não traz artefato não zera o que
 * já está gravado. Uma nota autorizada cuja consulta seguinte venha sem XML
 * perderia o artefato se a escrita fosse incondicional — e o XML autorizado é
 * justamente o que não pode sumir.
 *
 * ## O que continua faltando, e é de propósito
 *
 * `fiscal_document_items` **não** é reconstruído. Reconstruí-lo exigiria montar
 * o `NfePayload` de novo (`buildPayload`), e o payload de agora pode não ser o
 * que foi declarado à SEFAZ na hora — cadastro de cliente, preço e alíquota
 * mudam. Gravar itens que divergem do XML autorizado seria pior que não gravar
 * nenhum: o XML fica no cabeçalho e é a prova do que foi declarado. Fechar essa
 * lacuna direito é reprocessamento, ou seja, A7.
 */
export async function persistQueryStatus(
  admin: SupabaseClient,
  input: PersistQueryStatusInput,
): Promise<void> {
  const { documentId, branchId, ambiente, document, previousStatus, createdBy } = input;
  const origem = input.origem ?? "consulta";

  const patch: Record<string, unknown> = {
    status: document.status,
    chave: document.chave,
    numero: document.numero,
    serie: document.serie,
    protocolo: document.protocolo,
    status_sefaz: document.statusSefaz,
    mensagem_sefaz: document.mensagemSefaz,
    updated_at: new Date().toISOString(),
  };
  if (document.xml?.content) patch.xml_content = document.xml.content;
  if (document.xml?.path) patch.xml_path = document.xml.path;
  if (document.pdf?.content) patch.pdf_content = document.pdf.content;
  if (document.pdf?.path) patch.pdf_path = document.pdf.path;
  if (document.qrCodeUrl) patch.qr_code_url = document.qrCodeUrl;

  const { error } = await admin.from("fiscal_documents").update(patch).eq("id", documentId);
  if (error) throw error;

  // Só a consulta que **resolve uma reserva** tem evento a registrar: a nota
  // saiu, e `persistEmission` não chegou a gravar o `autorizacao`/`rejeicao` da
  // primeira tentativa. Reperguntar por uma nota já gravada não é fato novo, e
  // um evento por consulta encheria a auditoria de ruído.
  if (previousStatus !== RESERVA_STATUS) return;

  const { error: eventError } = await admin.from("fiscal_document_events").insert({
    branch_id: branchId,
    fiscal_document_id: documentId,
    tipo: document.status === "autorizado" ? "autorizacao" : "rejeicao",
    ambiente,
    status_sefaz: document.statusSefaz,
    mensagem_sefaz: document.mensagemSefaz,
    request_payload: { origem, motivo: "reserva_resolvida" },
    response_payload: { status: document.status, chave: document.chave, protocolo: document.protocolo },
    xml_content: null,
    xml_path: null,
    created_by: createdBy,
  });
  if (eventError) {
    // Mesma disciplina de `releaseStuckReservation`: o desfecho já está gravado
    // no cabeçalho, que é o registro que não pode ser perdido. Falhar aqui
    // esconderia uma nota que existe.
    console.error(
      "[fiscal-emit] desfecho gravado pela consulta, mas o evento não foi",
      documentId,
      eventError.message,
    );
  }
}

export type ReleaseStuckReservationInput = {
  documentId: string;
  branchId: string;
  ambiente: FiscalAmbiente;
  /** O que vai para `mensagem_sefaz` e para o evento — ver `MENSAGEM_RESERVA_LIBERADA`. */
  mensagem: string;
  /** Nulo quando quem libera é a varredura de A7 — ver `PersistQueryStatusInput.createdBy`. */
  createdBy: string | null;
  origem?: OrigemReconciliacao;
};

/**
 * **Libera uma reserva órfã, depois de o provedor ter dito que não conhece a
 * `ref`** (A6, 09/09/2026).
 *
 * Só é chamada por `handleQuery`, e só quando `decideConsulta` devolveu
 * `liberar` — nunca por idade da reserva, nunca sem consultar. O raciocínio de
 * por que a consulta é obrigatória está em `reservation.ts`.
 *
 * Três escolhas, cada uma pelo mesmo motivo de A5 — quem decide o efeito é o
 * banco, não a ordem em que dois processos leram:
 *
 * 1. **É um compare-and-swap**, `where id = ? and status = 'processando_autorizacao'`.
 *    Entre a consulta ao provedor e esta escrita há uma janela: a requisição
 *    original pode não estar morta, só lenta, e voltar a gravar o desfecho dela
 *    no meio. Se isso acontecer, o `where` não casa, nada é escrito, e quem
 *    chamou recebe `false` — o desfecho de verdade é o que a outra gravou.
 * 2. **Muda o status em vez de apagar a linha.** `releaseEmission` apaga quando
 *    a reserva nasceu de um `insert`, porque ali a linha é sempre nova e não tem
 *    filho nenhum. Aqui não há como saber: a reserva pode ter sido tomada por
 *    cima de uma nota recusada (o CAS de `reserveEmission`), e
 *    `fiscal_document_items`/`fiscal_document_events` apontam para ela com
 *    `on delete cascade`. Apagar levaria junto o histórico de rejeições.
 * 3. **Registra um evento `rejeicao`.** É o que transforma a liberação numa
 *    transição auditável — quem liberou, quando, e sobre qual justificativa —
 *    em vez de uma linha que mudou de status sem rastro. O `request_payload`
 *    guarda a origem da decisão para quem for auditar depois.
 *
 * A falha ao gravar o evento **não** desfaz nem esconde a liberação: ela já
 * aconteceu, e mentir sobre isso deixaria o operador esperando por uma nota que
 * não vai sair. Vai para o log, mesma disciplina de `releaseEmission`.
 *
 * @returns `true` se esta requisição foi quem liberou; `false` se a linha já
 *   não estava mais em `processando_autorizacao` quando a escrita chegou.
 */
export async function releaseStuckReservation(
  admin: SupabaseClient,
  input: ReleaseStuckReservationInput,
): Promise<boolean> {
  const { documentId, branchId, ambiente, mensagem, createdBy } = input;
  const origem = input.origem ?? "consulta";

  const { data, error } = await admin
    .from("fiscal_documents")
    .update({
      status: STATUS_APOS_LIBERAR,
      status_sefaz: null,
      mensagem_sefaz: mensagem,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("status", RESERVA_STATUS)
    .select("id");
  if (error) throw error;
  if (!data || (data as unknown[]).length === 0) return false;

  const { error: eventError } = await admin.from("fiscal_document_events").insert({
    branch_id: branchId,
    fiscal_document_id: documentId,
    tipo: "rejeicao",
    ambiente,
    status_sefaz: null,
    mensagem_sefaz: mensagem,
    request_payload: { origem, motivo: "reserva_orfa" },
    response_payload: { status: "nao_encontrado" },
    xml_content: null,
    xml_path: null,
    created_by: createdBy,
  });
  if (eventError) {
    console.error(
      "[fiscal-emit] reserva liberada, mas o evento não foi gravado",
      documentId,
      eventError.message,
    );
  }
  return true;
}

/* ------------------------------------------------------------------------ */
/* A fila de reprocessamento agendado (A7, 09/09/2026)                       */
/* ------------------------------------------------------------------------ */

/**
 * A linha presa, com o que a varredura precisa para consultar o provedor.
 *
 * Acrescenta três colunas ao `FiscalDocumentRow` de sempre: a origem (venda ou
 * devolução, para a mensagem que `decideConsulta` monta) e `updated_at`, que é
 * quando a reserva foi tomada — ver `CandidatoFila.reservadaEm`.
 */
export type StuckReservationRow = FiscalDocumentRow & {
  sale_id: string | null;
  sale_return_id: string | null;
  updated_at: string;
};

/**
 * As reservas presas há mais tempo, da mais velha para a mais nova.
 *
 * O filtro por status e por idade também acontece aqui, no banco, e **não** é
 * quem decide: quem decide é `decideElegibilidade` (`queue.ts`), que reavalia
 * os dois. Filtrar no SQL existe para a janela não vir cheia de reserva recém
 * criada — que é o caso comum, e o único de verdade enquanto os provedores
 * forem síncronos.
 *
 * `order("updated_at")` ascendente é fairness, não otimização: quem está
 * esperando há mais tempo é atendido primeiro.
 */
export async function readStuckReservations(
  admin: SupabaseClient,
  corte: string,
  limite: number,
): Promise<StuckReservationRow[]> {
  const { data, error } = await admin
    .from("fiscal_documents")
    .select(`${DOCUMENT_COLUMNS}, sale_id, sale_return_id, updated_at`)
    .eq("status", RESERVA_STATUS)
    .lt("updated_at", corte)
    .order("updated_at", { ascending: true })
    .limit(limite);
  if (error) throw error;
  return (data ?? []) as unknown as StuckReservationRow[];
}

/** O que `fiscal_queue` guarda de cada documento que a fila já tentou resolver. */
export type FiscalQueueRow = {
  fiscal_document_id: string;
  tentativas: number;
  proxima_tentativa_em: string;
};

/**
 * Quantos ids cabem num `in.(...)` sem esbarrar no tamanho da URL.
 *
 * O PostgREST recebe o filtro na **query string**, e um UUID custa 37
 * caracteres com a vírgula: a janela inteira da varredura (200 candidatos)
 * daria ~7,4 KB de URL, contra um limite de linha de requisição que fica na
 * casa dos 8 KB no gateway. Passar perto disso é ruim de um jeito específico —
 * a leitura só estouraria quando houvesse **muita** reserva presa, ou seja,
 * exatamente na hora em que a varredura precisa funcionar. Em blocos de 50 a
 * URL fica em ~1,9 KB e a conta deixa de depender do tamanho da janela.
 */
const IDS_POR_CONSULTA = 50;

/**
 * As linhas de `fiscal_queue` dos documentos informados, indexadas por
 * documento.
 *
 * Duas leituras em vez de um join porque o PostgREST não expressa bem "traga a
 * linha da esquerda mesmo sem a da direita" — e porque a decisão que usa as
 * duas mora em `queue.ts`, fora do banco, onde ela é testável.
 */
export async function readQueueEntries(
  admin: SupabaseClient,
  documentIds: string[],
): Promise<Map<string, FiscalQueueRow>> {
  const porDocumento = new Map<string, FiscalQueueRow>();

  for (let inicio = 0; inicio < documentIds.length; inicio += IDS_POR_CONSULTA) {
    const bloco = documentIds.slice(inicio, inicio + IDS_POR_CONSULTA);
    const { data, error } = await admin
      .from("fiscal_queue")
      .select("fiscal_document_id, tentativas, proxima_tentativa_em")
      .in("fiscal_document_id", bloco);
    if (error) throw error;

    for (const row of (data ?? []) as unknown as FiscalQueueRow[]) {
      porDocumento.set(row.fiscal_document_id, row);
    }
  }

  return porDocumento;
}

export type SaveQueueEntryInput = {
  fiscalDocumentId: string;
  tentativas: number;
  proximaTentativaEm: string;
  /** O que deu errado na última tentativa, ou `null` quando ela não falhou. */
  ultimoErro: string | null;
};

/**
 * Grava o resultado de uma tentativa da fila.
 *
 * `upsert` por `fiscal_document_id` (índice único) — a linha nasce na primeira
 * tentativa que **não** resolveu o documento e é reescrita nas seguintes.
 *
 * **Nunca lança.** Ela é bookkeeping: uma falha aqui não pode derrubar o tique
 * inteiro nem esconder o que a consulta já conseguiu escrever em
 * `fiscal_documents`. O pior efeito de perder esta escrita é a linha ser tentada
 * de novo no próximo tique sem backoff — barato, e visível no log.
 */
export async function saveQueueEntry(
  admin: SupabaseClient,
  input: SaveQueueEntryInput,
): Promise<void> {
  const { error } = await admin.from("fiscal_queue").upsert(
    {
      fiscal_document_id: input.fiscalDocumentId,
      tentativas: input.tentativas,
      ultima_tentativa_em: new Date().toISOString(),
      proxima_tentativa_em: input.proximaTentativaEm,
      ultimo_erro: input.ultimoErro,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "fiscal_document_id" },
  );
  if (error) {
    console.error("[fiscal-emit] falha ao gravar a fila", input.fiscalDocumentId, error.message);
  }
}

/**
 * Tira o documento da fila — ele saiu de `processando_autorizacao` e não há mais
 * o que perguntar.
 *
 * A fila guarda só **o que ainda está sendo perseguido**; o rastro do que
 * aconteceu é `fiscal_document_events`, que `persistQueryStatus` e
 * `releaseStuckReservation` escrevem com `request_payload.origem = "fila"`.
 * Manter a linha aqui depois de resolvida duplicaria esse histórico num lugar
 * que ninguém audita.
 *
 * **Nunca lança**, pelo mesmo motivo de `saveQueueEntry`.
 */
export async function clearQueueEntry(
  admin: SupabaseClient,
  fiscalDocumentId: string,
): Promise<void> {
  const { error } = await admin
    .from("fiscal_queue")
    .delete()
    .eq("fiscal_document_id", fiscalDocumentId);
  if (error) {
    console.error("[fiscal-emit] falha ao limpar a fila", fiscalDocumentId, error.message);
  }
}
