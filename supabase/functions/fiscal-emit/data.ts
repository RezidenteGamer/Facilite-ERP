/**
 * **O que a Edge Function lê do banco antes de montar uma nota.**
 *
 * Este arquivo é o ponto inteiro da tarefa A1. Até 01/09/2026 quem montava a
 * nota era o navegador, a partir de dados que a tela já tinha em mãos: preço
 * unitário, desconto, total, alíquota — tudo vinha do estado do React e ia,
 * pelo `NfePayload`, para dentro do XML. Um cliente adulterado podia declarar à
 * SEFAZ um valor que a venda não tinha.
 *
 * Agora nada disso viaja: a requisição diz **qual** venda (ou devolução) emitir,
 * e é aqui que a venda, os itens, o produto, o grupo tributário, o cliente e a
 * filial são lidos com `service_role`. Mesmo espírito da decisão C3 (29/08/2026)
 * para as RPCs de venda — preço e dado sensível vêm do banco, não do payload.
 *
 * As consultas são as mesmas que moravam em `fetchSaleForInvoice`
 * (`src/lib/repositories/fiscalDocumentsRepository.ts`) e
 * `fetchSaleReturnForInvoice` (`saleReturnsRepository.ts`), que deixaram de
 * existir no front nesta tarefa — não é uma segunda implementação, é a mudança
 * de lado da fronteira.
 *
 * ## Por que os `select` têm tipo escrito à mão
 *
 * O front cria o cliente com `createClient<Database>` e os tipos gerados dizem,
 * por FK, se um relacionamento aninhado é um objeto ou uma lista. Aqui não há
 * `Database` (os tipos gerados vivem em `src/types/`, do outro lado da
 * fronteira), então o supabase-js infere **lista** para todo relacionamento e o
 * `tsc` acusa `data.branch.cnpj` como erro. Declarar a forma esperada e
 * converter uma vez é melhor do que tipar o cliente como `any`: o `map` que vem
 * depois continua checado, e a forma fica documentada ao lado da consulta.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import type { SaleForInvoice, SaleReturnForInvoice } from "../_shared/fiscal/invoiceMapping.ts";
import { MVA_RULE_COLUMNS, toMvaRuleRow, type MvaRuleRow } from "../_shared/fiscal/mvaRules.ts";
import { IBPT_RATE_COLUMNS, toIbptRateRow, type IbptRateRow } from "../_shared/fiscal/ibptRates.ts";
import { TAX_GROUP_COLUMNS, toTaxGroup } from "../_shared/fiscal/taxGroups.ts";
import { toTaxRuleRow, type TaxRuleRow } from "../_shared/fiscal/taxRules.ts";

/**
 * O produto e o grupo tributário dele, aninhados. Igual nos dois `select`
 * (venda e devolução) — a nota de devolução descreve os mesmos produtos.
 */
const PRODUCT_COLUMNS =
  `product:products(code, description, ncm, cest, unidade_comercial, unidade_tributavel, origem_mercadoria, cst_ipi, ` +
  `tax_group:tax_groups(${TAX_GROUP_COLUMNS}))`;

/**
 * Erro de negócio da leitura — venda inexistente, cancelada, sem filial.
 *
 * Classe própria (e não `Error`) para o `index.ts` conseguir separar "o pedido
 * não faz sentido" (vira `{ ok: false, errors }`, 200) de "o banco caiu" (vira
 * 500). Mesma linha divisória do contrato `FiscalProvider`: rejeição de negócio
 * é resultado, falha de transporte é exceção.
 */
export class FiscalDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FiscalDataError";
  }
}

/** O que uma leitura devolve: os dados da nota mais a filial **do banco**. */
export type SaleSource = {
  /** A filial verdadeira da venda. Nunca a que veio na requisição. */
  branchId: string;
  sale: SaleForInvoice;
};

export type SaleReturnSource = {
  branchId: string;
  saleReturn: SaleReturnForInvoice;
};

/* ------------------------------------------------------------------------ */
/* A forma esperada de cada consulta — ver o cabeçalho                       */
/* ------------------------------------------------------------------------ */

type BranchRow = {
  cnpj: string | null;
  name: string;
  inscricao_estadual: string | null;
  regime_tributario: string | null;
  /** Aceita `undefined`: a linha pode vir de um banco onde a migration de B8 ainda não rodou. */
  aliquota_credito_icms_simples: number | null | undefined;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
};

type ContactRow = {
  name: string;
  document: string;
  inscricao_estadual: string | null;
  indicador_ie: string | null;
  /** Aceita `undefined`: a linha pode vir de um banco onde a migration de 04/09/2026 ainda não rodou. */
  regime_tributario: string | null | undefined;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
  phone: string | null;
};

type ProductRow = {
  code: string;
  description: string;
  ncm: string | null;
  cest: string | null;
  unidade_comercial: string | null;
  unidade_tributavel: string | null;
  origem_mercadoria: string | null;
  cst_ipi: string | null;
  tax_group: Parameters<typeof toTaxGroup>[0] | null;
};

type ItemRow = {
  quantity: number;
  unit_price: number;
  discount_amount: number;
  total_amount: number;
  product: ProductRow | null;
};

type SaleQueryRow = {
  branch_id: string;
  status: string;
  code: string;
  issue_date: string;
  subtotal_amount: number;
  total_amount: number;
  discount_amount: number;
  freight_amount: number;
  operation_type: string | null;
  branch: BranchRow | null;
  contact: ContactRow | null;
  items: ItemRow[] | null;
  payments: { method: string; amount: number }[] | null;
};

type SaleReturnQueryRow = {
  branch_id: string;
  status: string;
  code: string;
  issue_date: string;
  total_amount: number;
  sale: {
    code: string;
    branch: BranchRow | null;
    contact: ContactRow | null;
    invoices: { status: string; chave: string | null; updated_at: string }[] | null;
  } | null;
  items: ItemRow[] | null;
};

type TaxRuleQueryRow = Parameters<typeof toTaxRuleRow>[0];
type MvaRuleQueryRow = Parameters<typeof toMvaRuleRow>[0];
type IbptRateQueryRow = Parameters<typeof toIbptRateRow>[0];

function toInvoiceBranch(branch: BranchRow): SaleForInvoice["branch"] {
  return {
    cnpj: branch.cnpj,
    name: branch.name,
    inscricaoEstadual: branch.inscricao_estadual,
    regimeTributario: branch.regime_tributario,
    // `?? null` pelo mesmo motivo das colunas novas de B1/B5 em `toTaxGroup`:
    // enquanto a migration de B8 não estiver aplicada o `select` volta sem a
    // coluna, e `undefined !== null` faria toda filial parecer ter alíquota de
    // crédito cadastrada — declarando `pCredSN: undefined` num campo
    // obrigatório em vez de recusar com mensagem.
    aliquotaCreditoIcmsSimples: branch.aliquota_credito_icms_simples ?? null,
    logradouro: branch.logradouro,
    numero: branch.numero,
    bairro: branch.bairro,
    municipio: branch.municipio,
    uf: branch.uf,
    cep: branch.cep,
  };
}

function toInvoiceContact(contact: ContactRow | null): SaleForInvoice["contact"] {
  if (!contact) return null;
  return {
    name: contact.name,
    document: contact.document,
    inscricaoEstadual: contact.inscricao_estadual,
    indicadorIe: contact.indicador_ie,
    // `?? null` porque o valor tem de significar "não sei" — que é o que não
    // recusa a emissão do CSOSN 101/201 — em vez de `undefined`. A coluna está
    // nomeada no `select`, então enquanto a migration de 04/09/2026 não rodar
    // o PostgREST responde 400 e nenhuma nota é montada (ver a ordem de
    // aplicação na migration); o `?? null` cobre o resto: qualquer resposta que
    // venha sem o campo cai no lado seguro em vez de vazar `undefined`.
    regimeTributario: contact.regime_tributario ?? null,
    logradouro: contact.logradouro,
    numero: contact.numero,
    bairro: contact.bairro,
    municipio: contact.municipio,
    uf: contact.uf,
    cep: contact.cep,
    phone: contact.phone,
  };
}

function toInvoiceItems(items: ItemRow[]): SaleForInvoice["items"] {
  return items.map((item) => {
    if (!item.product) {
      // FK obrigatória em `sale_items`/`sale_return_items`: só acontece se o
      // join vier vazio por engano. Falha alto em vez de emitir item sem
      // descrição.
      throw new FiscalDataError("Item sem produto associado — não é possível emitir a nota.");
    }
    return {
      quantity: item.quantity,
      unitPrice: item.unit_price,
      discountAmount: item.discount_amount,
      totalAmount: item.total_amount,
      product: {
        code: item.product.code,
        description: item.product.description,
        ncm: item.product.ncm,
        cest: item.product.cest,
        unidadeComercial: item.product.unidade_comercial,
        unidadeTributavel: item.product.unidade_tributavel,
        origemMercadoria: item.product.origem_mercadoria,
        cstIpi: item.product.cst_ipi,
        // Nulo quando o produto não foi atrelado a nenhum grupo — quem recusa
        // a emissão com mensagem é o mapeamento, não a leitura.
        taxGroup: item.product.tax_group ? toTaxGroup(item.product.tax_group) : null,
      },
    };
  });
}

export async function readSaleForInvoice(admin: SupabaseClient, saleId: string): Promise<SaleSource> {
  const { data, error } = await admin
    .from("sales")
    .select(
      `branch_id, status, code, issue_date, subtotal_amount, total_amount, discount_amount, freight_amount, operation_type,
       branch:branches(cnpj, name, inscricao_estadual, regime_tributario, aliquota_credito_icms_simples, logradouro, numero, bairro, municipio, uf, cep),
       contact:contacts(name, document, inscricao_estadual, indicador_ie, regime_tributario, logradouro, numero, bairro, municipio, uf, cep, phone),
       items:sale_items(quantity, unit_price, discount_amount, total_amount, ${PRODUCT_COLUMNS}),
       payments:sale_payments(method, amount)`,
    )
    .eq("id", saleId)
    .maybeSingle();
  if (error) throw error;

  const row = data as unknown as SaleQueryRow | null;
  if (!row) throw new FiscalDataError("Venda não encontrada.");
  if (!row.branch) throw new FiscalDataError("Venda sem filial associada.");
  if (row.status !== "confirmed") {
    throw new FiscalDataError("Esta venda não está confirmada — não há o que emitir.");
  }

  return {
    branchId: row.branch_id,
    sale: {
      code: row.code,
      issueDate: row.issue_date,
      subtotalAmount: row.subtotal_amount,
      totalAmount: row.total_amount,
      discountAmount: row.discount_amount,
      freightAmount: row.freight_amount,
      operationType: row.operation_type ?? undefined,
      branch: toInvoiceBranch(row.branch),
      contact: toInvoiceContact(row.contact),
      payments: (row.payments ?? []).map((payment) => ({
        method: payment.method,
        amount: payment.amount,
      })),
      items: toInvoiceItems(row.items ?? []),
    },
  };
}

/**
 * A devolução vista como nota: filial e cliente vêm da **venda original** (é ela
 * que a devolução desfaz), os itens são os devolvidos, e `originalChave` é a
 * chave da nota da venda — nula quando a venda nunca teve nota autorizada, que
 * é caso legítimo.
 */
export async function readSaleReturnForInvoice(
  admin: SupabaseClient,
  saleReturnId: string,
): Promise<SaleReturnSource> {
  const { data, error } = await admin
    .from("sale_returns")
    .select(
      `branch_id, status, code, issue_date, total_amount,
       sale:sales(code,
         branch:branches(cnpj, name, inscricao_estadual, regime_tributario, aliquota_credito_icms_simples, logradouro, numero, bairro, municipio, uf, cep),
         contact:contacts(name, document, inscricao_estadual, indicador_ie, regime_tributario, logradouro, numero, bairro, municipio, uf, cep, phone),
         invoices:fiscal_documents(status, chave, updated_at)),
       items:sale_return_items(quantity, unit_price, discount_amount, total_amount, ${PRODUCT_COLUMNS})`,
    )
    .eq("id", saleReturnId)
    .maybeSingle();
  if (error) throw error;

  const row = data as unknown as SaleReturnQueryRow | null;
  if (!row) throw new FiscalDataError("Devolução não encontrada.");
  if (!row.sale?.branch) throw new FiscalDataError("Devolução sem filial associada.");
  if (row.status !== "confirmed") {
    throw new FiscalDataError("Esta devolução não está confirmada — não há o que emitir.");
  }

  const items = row.items ?? [];
  const authorized = (row.sale.invoices ?? []).find((invoice) => invoice.status === "autorizado");

  return {
    branchId: row.branch_id,
    saleReturn: {
      code: row.code,
      saleCode: row.sale.code,
      issueDate: row.issue_date,
      totalAmount: row.total_amount,
      discountAmount: items.reduce((sum, item) => sum + item.discount_amount, 0),
      originalChave: authorized?.chave ?? null,
      branch: toInvoiceBranch(row.sale.branch),
      contact: toInvoiceContact(row.sale.contact),
      items: toInvoiceItems(items),
    },
  };
}

/** As regras de CFOP cadastradas em Tributações — quem as aplica é `resolveTaxRule`. */
export async function readTaxRules(admin: SupabaseClient): Promise<TaxRuleRow[]> {
  const { data, error } = await admin
    .from("tax_rules")
    .select("id, regime, natureza_operacao, uf_origem, uf_destino, tipo_cliente, cfop");
  if (error) throw error;
  return ((data ?? []) as unknown as TaxRuleQueryRow[]).map(toTaxRuleRow);
}

/**
 * As MVAs cadastradas (módulo MVA (ICMS-ST)) — quem as aplica é
 * `resolveMvaRule`, dentro do mapeamento.
 *
 * Lê a tabela inteira, como `readTaxRules` já fazia com `tax_rules`, e pelo
 * mesmo motivo: são poucas linhas (uma por NCM × UF que o contador cadastrar),
 * o filtro depende do NCM de cada item da venda, e uma consulta por item
 * trocaria uma leitura por N idas ao banco dentro do laço de montagem.
 */
export async function readMvaRules(admin: SupabaseClient): Promise<MvaRuleRow[]> {
  const { data, error } = await admin.from("mva_rules").select(MVA_RULE_COLUMNS);
  if (error) throw error;
  return ((data ?? []) as unknown as MvaRuleQueryRow[]).map(toMvaRuleRow);
}

/**
 * Os percentuais da Lei da Transparência (módulo Tributos aproximados (IBPT))
 * — quem os aplica é `resolveIbptRate`, dentro do mapeamento (B9, 05/09/2026).
 *
 * Lê a tabela inteira, pelo mesmo motivo de `readTaxRules` e `readMvaRules`:
 * poucas linhas, filtro que depende do NCM de cada item, e uma consulta por
 * item trocaria uma leitura por N idas ao banco dentro do laço de montagem.
 */
export async function readIbptRates(admin: SupabaseClient): Promise<IbptRateRow[]> {
  const { data, error } = await admin.from("ibpt_rates").select(IBPT_RATE_COLUMNS);
  if (error) throw error;
  return ((data ?? []) as unknown as IbptRateQueryRow[]).map(toIbptRateRow);
}
