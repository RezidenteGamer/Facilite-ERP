/**
 * Mapeamento venda → `NfePayload` (etapa 8, Notas Emitidas; etapa 8.5, NFC-e).
 *
 * O mapeamento de teste que provou o ciclo do `FiscalProvider` morava em
 * `scripts/fiscal-cycle-check.mjs`, de propósito (ver decisão da etapa F1 no
 * AGENTS.md) — não deveria virar código de produção. Esta é a versão de
 * verdade, e as funções nunca lançam exceção — devolvem `{ ok: false, errors }`
 * para a tela mostrar uma mensagem acionável, mesmo espírito de
 * `resolveTaxRule` e do `FiscalProvider`.
 *
 * ## De onde vem cada metade da tributação (correção de 19/08/2026)
 *
 * - **CFOP vem da operação**: `resolveTaxRule` decide, a partir das cinco
 *   dimensões (regime da filial, natureza, UF origem/destino, tipo de
 *   cliente). É o mesmo para todos os itens da venda — uma venda interna tem
 *   o mesmo CFOP para qualquer produto.
 * - **CST/CSOSN e alíquota vêm do produto**, via o grupo tributário dele
 *   (`products.tax_group_id` → `tax_groups`). Isso é **por item**: dois
 *   produtos na mesma venda podem ter tributação diferente (um com
 *   substituição tributária, outro isento), e a primeira versão desta função
 *   não conseguia representar isso — lia CST/alíquota de `rule` uma vez, fora
 *   do laço, e aplicava igual a todos os itens.
 *
 * ## NF-e × NFC-e: o que é reaproveitado e o que diverge (etapa 8.5)
 *
 * `resolveItemsForSale` (abaixo) é a parte genuinamente comum às duas: CFOP
 * pela operação, CST/alíquota por item, montagem dos itens e dos totais de
 * imposto. **Cliente não é**: NF-e exige destinatário identificado (mensagem
 * de erro própria, ver `buildNfePayloadFromSale`); NFC-e é o oposto — a
 * imensa maioria das vendas de balcão não tem CPF do cliente, e isso é normal,
 * não erro de cadastro. Por isso os dois têm função própria, cada uma com sua
 * validação de cabeçalho, em vez de uma função com um parâmetro
 * `requireContact` tentando cobrir os dois: a diferença não é um detalhe, é a
 * regra de negócio central que distingue os dois modelos.
 */

import { onlyDigits } from "../../lib/fiscal/accessKey";
import { resolveIcmsSituacaoTributaria, type TaxGroup } from "../../lib/fiscal/taxGroups";
import type { NfePayload, NfePayloadItem, NfePayloadPagamento } from "../../lib/fiscal/types";
import { resolveTaxRule, type TaxRuleQuery, type TaxRuleRow } from "../../lib/fiscal/taxRules";

export type SaleForInvoiceBranch = {
  cnpj: string | null;
  name: string;
  inscricaoEstadual: string | null;
  regimeTributario: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
};

export type SaleForInvoiceContact = {
  name: string;
  document: string;
  inscricaoEstadual: string | null;
  indicadorIe: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
  phone: string | null;
};

export type SaleForInvoiceProduct = {
  code: string;
  description: string;
  ncm: string | null;
  cest: string | null;
  unidadeComercial: string | null;
  unidadeTributavel: string | null;
  origemMercadoria: string | null;
  cstIpi: string | null;
  /**
   * O grupo tributário do produto — de onde saem CST/CSOSN e alíquotas deste
   * item. Nulo quando o produto ainda não foi atrelado a um grupo, o que
   * bloqueia a emissão com mensagem própria (não há grupo padrão de fallback:
   * emitir com tributação adivinhada é exatamente o erro silencioso que a
   * correção de 19/08/2026 existe para evitar).
   */
  taxGroup: TaxGroup | null;
};

export type SaleForInvoiceItem = {
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  totalAmount: number;
  product: SaleForInvoiceProduct;
};

/** `sale_payments.method`, cru — a conversão pro código da SEFAZ é de quem monta o payload de NFC-e. */
export type SaleForInvoicePayment = {
  method: string;
  amount: number;
};

export type SaleForInvoice = {
  code: string;
  issueDate: string;
  subtotalAmount: number;
  totalAmount: number;
  discountAmount: number;
  freightAmount: number;
  branch: SaleForInvoiceBranch;
  /** Nulo é o caso de venda sem cliente identificado (PDV) — NF-e exige cliente para emitir, NFC-e não. */
  contact: SaleForInvoiceContact | null;
  items: SaleForInvoiceItem[];
  payments: SaleForInvoicePayment[];
  /** Texto livre digitado pelo usuário em "Tipo de operação" — vai literal na `natureza_operacao` da nota. Não usar para casar regra fiscal. */
  operationType?: string;
};

export type BuildPayloadResult =
  | { ok: true; payload: NfePayload; cfop: string }
  | { ok: false; errors: string[] };

function isCnpj(document: string): boolean {
  return onlyDigits(document).length === 14;
}

/** Identifica o item nas mensagens de erro, para quem lê saber qual produto corrigir. */
function itemLabel(item: SaleForInvoiceItem, index: number): string {
  return `Item ${index + 1} (${item.product.code} — ${item.product.description})`;
}

/**
 * Deriva `tipo_cliente` (dimensão de `resolveTaxRule`) do documento e do
 * indicador de IE já normalizado: CPF é sempre consumidor final (pessoa
 * física não é contribuinte de ICMS); CNPJ com indicador 1 é contribuinte;
 * CNPJ com indicador 2/9/ausente é não contribuinte.
 *
 * Só usada por NF-e — NFC-e é **sempre** consumidor final, sem derivar de
 * nada (ver `buildNfcePayloadFromSale`).
 */
function resolveTipoCliente(document: string, indicadorIe: string | null): string {
  if (!isCnpj(document)) return "consumidor_final";
  return indicadorIe === "1" ? "contribuinte" : "nao_contribuinte";
}

/** `indicador_inscricao_estadual_destinatario` da SEFAZ: 1/2/9. Ausente vira 9 (o mais conservador). */
function resolveIndicadorIeCodigo(indicadorIe: string | null): number {
  if (indicadorIe === "1") return 1;
  if (indicadorIe === "2") return 2;
  return 9;
}

/** Valor de um imposto a partir da base e da alíquota (%), arredondado a centavos. */
function taxAmount(base: number, aliquota: number): number {
  return Math.round(base * (aliquota / 100) * 100) / 100;
}

type ResolvedItems = {
  cfop: string;
  items: NfePayloadItem[];
  icmsBaseCalculoTotal?: number;
  icmsValorTotal?: number;
  pisValorTotal?: number;
  cofinsValorTotal?: number;
};

type ItemsResolution = { ok: true; data: ResolvedItems } | { ok: false; errors: string[] };

/**
 * A parte genuinamente comum a NF-e e NFC-e: resolve o CFOP da operação
 * (`resolveTaxRule`) e, por item, o CST/CSOSN e as alíquotas a partir do
 * grupo tributário do produto. Não sabe nada sobre cliente/destinatário —
 * isso é responsabilidade de quem chama (a exigência diverge entre os dois
 * modelos).
 */
function resolveItemsForSale(sale: SaleForInvoice, rules: TaxRuleRow[], query: TaxRuleQuery): ItemsResolution {
  const errors: string[] = [];
  if (sale.items.length === 0) errors.push("Venda sem itens.");

  sale.items.forEach((item, index) => {
    if (!item.product.ncm?.trim()) {
      errors.push(`${itemLabel(item, index)}: NCM não cadastrado. Cadastre o NCM em Produtos.`);
    }
    if (!item.product.taxGroup) {
      errors.push(
        `${itemLabel(item, index)}: sem grupo tributário. Atrele o produto a um grupo em Produtos ` +
          `(cadastre os grupos em Grupos tributários).`,
      );
    }
  });

  if (errors.length > 0) return { ok: false, errors };

  const resolution = resolveTaxRule(query, rules);
  if (!resolution.found) {
    return { ok: false, errors: [resolution.reason] };
  }
  const cfop = resolution.cfop;

  const icmsErrors: string[] = [];
  const items: NfePayloadItem[] = sale.items.map((item, index) => {
    const group = item.product.taxGroup!;
    const base = item.totalAmount;

    // Por item, e a partir do grupo daquele produto: é isto que faz dois
    // produtos da mesma venda saírem com tributação diferente.
    const icmsSituacaoTributaria = resolveIcmsSituacaoTributaria(group, query.regime);
    if (!icmsSituacaoTributaria) {
      icmsErrors.push(
        `${itemLabel(item, index)}: o grupo tributário "${group.name}" não tem CST ICMS nem CSOSN ` +
          `cadastrado. Complete o cadastro em Grupos tributários.`,
      );
    }

    const icmsAliquota = group.aliquotaIcms ?? undefined;
    const pisAliquota = group.aliquotaPis ?? undefined;
    const cofinsAliquota = group.aliquotaCofins ?? undefined;

    return {
      numero_item: index + 1,
      codigo_produto: item.product.code,
      descricao: item.product.description,
      cfop,
      codigo_ncm: item.product.ncm!,
      codigo_cest: item.product.cest ?? undefined,
      quantidade_comercial: item.quantity,
      valor_unitario_comercial: item.unitPrice,
      valor_bruto: item.totalAmount,
      unidade_comercial: item.product.unidadeComercial ?? undefined,
      unidade_tributavel: item.product.unidadeTributavel ?? undefined,
      valor_desconto: item.discountAmount || undefined,
      inclui_no_total: 1,

      // Campo obrigatório no schema da SEFAZ (não opcional em NfePayloadItem);
      // "" quando o cadastro do produto ainda não tem origem preenchida.
      icms_origem: item.product.origemMercadoria ?? "",
      icms_situacao_tributaria: icmsSituacaoTributaria ?? "",
      icms_base_calculo: icmsAliquota !== undefined ? base : undefined,
      icms_aliquota: icmsAliquota,
      icms_valor: icmsAliquota !== undefined ? taxAmount(base, icmsAliquota) : undefined,

      // IPI continua no cadastro do produto: `tax_groups` não tem campo de
      // IPI, então ele não era redundante com o grupo (ver AGENTS.md).
      ipi_situacao_tributaria: item.product.cstIpi ?? undefined,

      pis_situacao_tributaria: group.cstPis ?? undefined,
      pis_base_calculo: pisAliquota !== undefined ? base : undefined,
      pis_aliquota_porcentual: pisAliquota,
      pis_valor: pisAliquota !== undefined ? taxAmount(base, pisAliquota) : undefined,

      cofins_situacao_tributaria: group.cstCofins ?? undefined,
      cofins_base_calculo: cofinsAliquota !== undefined ? base : undefined,
      cofins_aliquota_porcentual: cofinsAliquota,
      cofins_valor: cofinsAliquota !== undefined ? taxAmount(base, cofinsAliquota) : undefined,
    };
  });

  if (icmsErrors.length > 0) return { ok: false, errors: icmsErrors };

  const icmsValorTotal = items.reduce((sum, item) => sum + (item.icms_valor ?? 0), 0) || undefined;
  const pisValorTotal = items.reduce((sum, item) => sum + (item.pis_valor ?? 0), 0) || undefined;
  const cofinsValorTotal = items.reduce((sum, item) => sum + (item.cofins_valor ?? 0), 0) || undefined;
  const icmsBaseCalculoTotal =
    icmsValorTotal !== undefined ? items.reduce((s, i) => s + (i.icms_base_calculo ?? 0), 0) : undefined;

  return { ok: true, data: { cfop, items, icmsBaseCalculoTotal, icmsValorTotal, pisValorTotal, cofinsValorTotal } };
}

export function buildNfePayloadFromSale(sale: SaleForInvoice, rules: TaxRuleRow[]): BuildPayloadResult {
  const errors: string[] = [];

  if (!sale.contact) {
    errors.push("Venda sem cliente identificado — não é possível emitir NF-e sem destinatário.");
  }
  if (!sale.branch.cnpj) errors.push("Filial sem CNPJ cadastrado.");
  if (!sale.branch.uf) errors.push("Filial sem UF cadastrada (cadastro de filial é só por SQL, por enquanto).");
  if (!sale.branch.regimeTributario) errors.push("Filial sem regime tributário cadastrado.");
  if (sale.contact && !sale.contact.uf) errors.push("Cliente sem UF cadastrada — edite o endereço do cliente.");

  if (errors.length > 0) return { ok: false, errors };

  // A partir daqui as validações acima garantem que branch/contact têm o essencial.
  const branch = sale.branch;
  const contact = sale.contact!;
  const regime = branch.regimeTributario!;
  const document = onlyDigits(contact.document);
  const tipoCliente = resolveTipoCliente(contact.document, contact.indicadorIe);

  const query: TaxRuleQuery = {
    regime,
    naturezaOperacao: "venda",
    ufOrigem: branch.uf!,
    ufDestino: contact.uf!,
    tipoCliente,
  };

  const resolved = resolveItemsForSale(sale, rules, query);
  if (!resolved.ok) return resolved;
  const { cfop, items, icmsBaseCalculoTotal, icmsValorTotal, pisValorTotal, cofinsValorTotal } = resolved.data;

  const localDestino = branch.uf === contact.uf ? 1 : 2;

  const payload: NfePayload = {
    natureza_operacao: sale.operationType?.trim() || "Venda de mercadoria",
    data_emissao: new Date(`${sale.issueDate}T12:00:00-03:00`).toISOString(),
    tipo_documento: 1,
    finalidade_emissao: 1,
    consumidor_final: tipoCliente === "consumidor_final" ? 1 : 0,
    presenca_comprador: 1,
    local_destino: localDestino,

    cnpj_emitente: branch.cnpj!,
    nome_emitente: branch.name,
    logradouro_emitente: branch.logradouro ?? undefined,
    numero_emitente: branch.numero ?? undefined,
    bairro_emitente: branch.bairro ?? undefined,
    municipio_emitente: branch.municipio ?? undefined,
    uf_emitente: branch.uf ?? undefined,
    cep_emitente: branch.cep ?? undefined,
    inscricao_estadual_emitente: branch.inscricaoEstadual ?? undefined,
    regime_tributario_emitente: Number.parseInt(regime, 10),

    nome_destinatario: contact.name,
    cnpj_destinatario: isCnpj(contact.document) ? document : undefined,
    cpf_destinatario: !isCnpj(contact.document) ? document : undefined,
    inscricao_estadual_destinatario: contact.inscricaoEstadual ?? undefined,
    indicador_inscricao_estadual_destinatario: resolveIndicadorIeCodigo(contact.indicadorIe),
    logradouro_destinatario: contact.logradouro ?? undefined,
    numero_destinatario: contact.numero ?? undefined,
    bairro_destinatario: contact.bairro ?? undefined,
    municipio_destinatario: contact.municipio ?? undefined,
    uf_destinatario: contact.uf ?? undefined,
    cep_destinatario: contact.cep ?? undefined,
    pais_destinatario: "Brasil",
    telefone_destinatario: contact.phone ?? undefined,

    valor_produtos: sale.subtotalAmount,
    valor_total: sale.totalAmount,
    valor_desconto: sale.discountAmount || undefined,
    valor_frete: sale.freightAmount || undefined,
    icms_base_calculo: icmsBaseCalculoTotal,
    icms_valor_total: icmsValorTotal,
    valor_pis: pisValorTotal,
    valor_cofins: cofinsValorTotal,
    modalidade_frete: sale.freightAmount > 0 ? 0 : 9,

    items,
    informacoes_adicionais_contribuinte: `Venda ${sale.code}`,
  };

  return { ok: true, payload, cfop };
}

/** `sale_payments.method` → código de forma de pagamento da SEFAZ (grupo `pag`, obrigatório na NFC-e). */
const FORMA_PAGAMENTO_CODIGO: Record<string, string> = {
  dinheiro: "01",
  debito: "04",
  credito: "03",
  pix: "17",
  boleto: "15",
  outro: "99",
};

function buildFormasPagamento(payments: SaleForInvoicePayment[]): NfePayloadPagamento[] | undefined {
  if (payments.length === 0) return undefined;
  return payments.map((payment) => ({
    forma_pagamento: FORMA_PAGAMENTO_CODIGO[payment.method] ?? "99",
    valor_pagamento: payment.amount,
  }));
}

/**
 * Campos de destinatário para NFC-e — deliberadamente mais enxutos que os de
 * NF-e (`buildNfePayloadFromSale` acima): sem cliente, o grupo inteiro sai do
 * payload (não força nenhum campo vazio — não existe, no schema da Focus/
 * SEFAZ, um indicador de "operação sem identificação do destinatário": a
 * ausência do grupo `dest` já significa isso). Com cliente, manda só o que
 * identifica (nome + CPF/CNPJ, telefone se tiver) — sem exigir endereço
 * completo, que não se pede num balcão. IE só faz sentido para CNPJ.
 */
function buildNfceDestinatarioFields(contact: SaleForInvoiceContact | null): Partial<NfePayload> {
  if (!contact) return {};
  const document = onlyDigits(contact.document);
  const cnpj = isCnpj(contact.document);
  return {
    nome_destinatario: contact.name,
    cnpj_destinatario: cnpj ? document : undefined,
    cpf_destinatario: !cnpj ? document : undefined,
    telefone_destinatario: contact.phone ?? undefined,
    inscricao_estadual_destinatario: cnpj ? (contact.inscricaoEstadual ?? undefined) : undefined,
    indicador_inscricao_estadual_destinatario: cnpj ? resolveIndicadorIeCodigo(contact.indicadorIe) : undefined,
    pais_destinatario: "Brasil",
  };
}

/**
 * NFC-e (modelo 65) — etapa 8.5. Reaproveita `resolveItemsForSale` (CFOP +
 * CST/alíquota por item, idêntico à NF-e); diverge no cabeçalho:
 *
 * - **Cliente é opcional.** A maioria das vendas de balcão não identifica o
 *   comprador — isso é normal, não falta de cadastro, então (ao contrário de
 *   `buildNfePayloadFromSale`) a ausência de `sale.contact` não é erro aqui.
 * - **`consumidor_final` é sempre 1**, sem derivar de CPF/CNPJ/indicador de
 *   IE: NFC-e é por definição venda a consumidor final. Mesmo um cliente
 *   identificado com CNPJ compra como consumidor final no balcão.
 * - **`presenca_comprador` é sempre 1** (presencial — é venda de balcão).
 * - **UF de destino é sempre a UF da própria filial**, identificado ou não o
 *   cliente: a operação é presencial e interna por natureza (o comprador está
 *   fisicamente na loja), então não faz sentido usar a UF cadastrada de um
 *   cliente que mora em outro estado para decidir CFOP/local_destino — quem
 *   decide é onde a venda aconteceu, não onde o cliente mora.
 */
export function buildNfcePayloadFromSale(sale: SaleForInvoice, rules: TaxRuleRow[]): BuildPayloadResult {
  const errors: string[] = [];
  if (!sale.branch.cnpj) errors.push("Filial sem CNPJ cadastrado.");
  if (!sale.branch.uf) errors.push("Filial sem UF cadastrada (cadastro de filial é só por SQL, por enquanto).");
  if (!sale.branch.regimeTributario) errors.push("Filial sem regime tributário cadastrado.");

  if (errors.length > 0) return { ok: false, errors };

  const branch = sale.branch;
  const regime = branch.regimeTributario!;

  const query: TaxRuleQuery = {
    regime,
    naturezaOperacao: "venda",
    ufOrigem: branch.uf!,
    ufDestino: branch.uf!,
    tipoCliente: "consumidor_final",
  };

  const resolved = resolveItemsForSale(sale, rules, query);
  if (!resolved.ok) return resolved;
  const { cfop, items, icmsBaseCalculoTotal, icmsValorTotal, pisValorTotal, cofinsValorTotal } = resolved.data;

  const payload: NfePayload = {
    natureza_operacao: sale.operationType?.trim() || "Venda de mercadoria",
    data_emissao: new Date(`${sale.issueDate}T12:00:00-03:00`).toISOString(),
    tipo_documento: 1,
    finalidade_emissao: 1,
    consumidor_final: 1,
    presenca_comprador: 1,
    local_destino: 1,

    cnpj_emitente: branch.cnpj!,
    nome_emitente: branch.name,
    logradouro_emitente: branch.logradouro ?? undefined,
    numero_emitente: branch.numero ?? undefined,
    bairro_emitente: branch.bairro ?? undefined,
    municipio_emitente: branch.municipio ?? undefined,
    uf_emitente: branch.uf ?? undefined,
    cep_emitente: branch.cep ?? undefined,
    inscricao_estadual_emitente: branch.inscricaoEstadual ?? undefined,
    regime_tributario_emitente: Number.parseInt(regime, 10),

    ...buildNfceDestinatarioFields(sale.contact),

    valor_produtos: sale.subtotalAmount,
    valor_total: sale.totalAmount,
    valor_desconto: sale.discountAmount || undefined,
    valor_frete: sale.freightAmount || undefined,
    icms_base_calculo: icmsBaseCalculoTotal,
    icms_valor_total: icmsValorTotal,
    valor_pis: pisValorTotal,
    valor_cofins: cofinsValorTotal,
    modalidade_frete: sale.freightAmount > 0 ? 0 : 9,

    items,
    formas_pagamento: buildFormasPagamento(sale.payments),
    informacoes_adicionais_contribuinte: `Venda ${sale.code}`,
  };

  return { ok: true, payload, cfop };
}

/* ------------------------------------------------------------------------ */
/* Nota de devolução (etapa 9)                                               */
/* ------------------------------------------------------------------------ */

export type SaleReturnForInvoice = {
  /** Código da devolução (`sale_returns.code`) — vai nas informações adicionais. */
  code: string;
  /** Código da venda original — idem. */
  saleCode: string;
  issueDate: string;
  /** Soma dos itens devolvidos, já com o desconto proporcional descontado. */
  totalAmount: number;
  discountAmount: number;
  /**
   * Chave de acesso da nota da venda original, quando existe e está
   * autorizada. **Nula é caso legítimo** — uma venda que nunca teve nota
   * (ou cuja nota foi recusada) pode ser devolvida do mesmo jeito; o que a
   * ausência impede é *referenciar* a original, e quem decide o que fazer com
   * isso é a tela, não este mapeamento.
   */
  originalChave: string | null;
  branch: SaleForInvoiceBranch;
  contact: SaleForInvoiceContact | null;
  items: SaleForInvoiceItem[];
};

/**
 * NF-e de **devolução** (modelo 55, `finalidade_emissao: 4`) — etapa 9.
 *
 * Reaproveita `resolveItemsForSale` inteiro (CFOP pela operação, CST/alíquota
 * por item via grupo tributário do produto), trocando só a dimensão
 * `natureza_operacao` de `'venda'` para `'devolucao'`: é isso que faz o CFOP
 * sair da(s) regra(s) de devolução cadastradas em Tributações (CFOP de
 * **entrada**, 1202/2202 e afins) em vez do CFOP de venda. Sem regra
 * cadastrada, `resolveTaxRule` devolve `found: false` e a emissão para com a
 * mensagem acionável de sempre — comportamento esperado, não quebra.
 *
 * O que diverge de uma NF-e de venda, e por quê:
 *
 * - **`tipo_documento: 0`** (nota de entrada): a mercadoria está voltando para
 *   a loja. Numa venda é `1` (saída).
 * - **`finalidade_emissao: 4`** (devolução), contra `1` (normal) da venda.
 * - **`notas_referenciadas`** com a chave da nota original — é o que liga o
 *   documento de devolução ao que ele desfaz. Quando a venda não tem nota
 *   autorizada, o grupo simplesmente não vai (não se inventa uma chave).
 * - **`presenca_comprador: 0`** ("não se aplica"): quem emite é a loja, o
 *   comprador não está comprando nada nesta operação.
 *
 * Pesquisado contra a documentação da Focus NFe antes de desenhar (mesmo
 * procedimento das etapas F1/8/8.5) — ver `NfePayloadNotaReferenciada`.
 */
export function buildReturnNfePayload(saleReturn: SaleReturnForInvoice, rules: TaxRuleRow[]): BuildPayloadResult {
  const errors: string[] = [];

  if (!saleReturn.contact) {
    errors.push(
      "A venda devolvida não tem cliente identificado — a NF-e de devolução exige destinatário. " +
        "Se a venda saiu por NFC-e sem cliente, o caminho é cancelar a nota original (dentro do prazo).",
    );
  }
  if (!saleReturn.branch.cnpj) errors.push("Filial sem CNPJ cadastrado.");
  if (!saleReturn.branch.uf) errors.push("Filial sem UF cadastrada (cadastro de filial é só por SQL, por enquanto).");
  if (!saleReturn.branch.regimeTributario) errors.push("Filial sem regime tributário cadastrado.");
  if (saleReturn.contact && !saleReturn.contact.uf) {
    errors.push("Cliente sem UF cadastrada — edite o endereço do cliente.");
  }

  if (errors.length > 0) return { ok: false, errors };

  const branch = saleReturn.branch;
  const contact = saleReturn.contact!;
  const regime = branch.regimeTributario!;
  const document = onlyDigits(contact.document);
  const tipoCliente = resolveTipoCliente(contact.document, contact.indicadorIe);

  const query: TaxRuleQuery = {
    regime,
    naturezaOperacao: "devolucao",
    ufOrigem: branch.uf!,
    ufDestino: contact.uf!,
    tipoCliente,
  };

  // O "sale" que `resolveItemsForSale` recebe é a devolução vestida do mesmo
  // formato: os itens são os devolvidos, com a quantidade devolvida. Nenhuma
  // linha de tributação é reimplementada aqui.
  const asSale: SaleForInvoice = {
    code: saleReturn.code,
    issueDate: saleReturn.issueDate,
    subtotalAmount: saleReturn.totalAmount,
    totalAmount: saleReturn.totalAmount,
    discountAmount: saleReturn.discountAmount,
    freightAmount: 0,
    branch,
    contact,
    items: saleReturn.items,
    payments: [],
  };

  const resolved = resolveItemsForSale(asSale, rules, query);
  if (!resolved.ok) return resolved;
  const { cfop, items, icmsBaseCalculoTotal, icmsValorTotal, pisValorTotal, cofinsValorTotal } = resolved.data;

  const payload: NfePayload = {
    natureza_operacao: "Devolução de venda",
    data_emissao: new Date(`${saleReturn.issueDate}T12:00:00-03:00`).toISOString(),
    tipo_documento: 0,
    finalidade_emissao: 4,
    consumidor_final: tipoCliente === "consumidor_final" ? 1 : 0,
    presenca_comprador: 0,
    local_destino: branch.uf === contact.uf ? 1 : 2,

    cnpj_emitente: branch.cnpj!,
    nome_emitente: branch.name,
    logradouro_emitente: branch.logradouro ?? undefined,
    numero_emitente: branch.numero ?? undefined,
    bairro_emitente: branch.bairro ?? undefined,
    municipio_emitente: branch.municipio ?? undefined,
    uf_emitente: branch.uf ?? undefined,
    cep_emitente: branch.cep ?? undefined,
    inscricao_estadual_emitente: branch.inscricaoEstadual ?? undefined,
    regime_tributario_emitente: Number.parseInt(regime, 10),

    nome_destinatario: contact.name,
    cnpj_destinatario: isCnpj(contact.document) ? document : undefined,
    cpf_destinatario: !isCnpj(contact.document) ? document : undefined,
    inscricao_estadual_destinatario: contact.inscricaoEstadual ?? undefined,
    indicador_inscricao_estadual_destinatario: resolveIndicadorIeCodigo(contact.indicadorIe),
    logradouro_destinatario: contact.logradouro ?? undefined,
    numero_destinatario: contact.numero ?? undefined,
    bairro_destinatario: contact.bairro ?? undefined,
    municipio_destinatario: contact.municipio ?? undefined,
    uf_destinatario: contact.uf ?? undefined,
    cep_destinatario: contact.cep ?? undefined,
    pais_destinatario: "Brasil",
    telefone_destinatario: contact.phone ?? undefined,

    valor_produtos: saleReturn.totalAmount,
    valor_total: saleReturn.totalAmount,
    valor_desconto: saleReturn.discountAmount || undefined,
    icms_base_calculo: icmsBaseCalculoTotal,
    icms_valor_total: icmsValorTotal,
    valor_pis: pisValorTotal,
    valor_cofins: cofinsValorTotal,
    modalidade_frete: 9,

    notas_referenciadas: saleReturn.originalChave ? [{ chave_nfe: saleReturn.originalChave }] : undefined,

    items,
    informacoes_adicionais_contribuinte: `Devolução ${saleReturn.code} referente à venda ${saleReturn.saleCode}`,
  };

  return { ok: true, payload, cfop };
}
