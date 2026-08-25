/**
 * Devolução de venda (etapa 9) — leitura das devoluções e a chamada da RPC
 * `create_sale_return`.
 *
 * A criação é **sempre** pela RPC: estoque (volta), financeiro (novo `a_pagar`)
 * e as duas tabelas da devolução precisam acontecer juntos ou nenhum — não há
 * policy de `insert` em `sale_returns`/`sale_return_items` para o cliente
 * direto, mesmo padrão de `sales`/`purchases`/`stock_adjustments`.
 *
 * A parte fiscal **não** entra na transação de propósito: ela roda depois,
 * como passo separado e não bloqueante (ver `useSaleReturnsData.ts`) — não
 * existe "voltar atrás" de estoque já reposto por causa de uma nota que não
 * saiu, mesma filosofia já estabelecida no PDV/NFC-e.
 */
import { supabase } from "../supabaseClient";
import type { Tables } from "../../types/supabase";
import type { SaleReturnForInvoice } from "../../features/sales/invoiceMapping";
import { toInvoiceDocument, type InvoiceDocument } from "./fiscalDocumentsRepository";
import { toTaxGroup } from "./taxGroupLookups";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

type SaleReturnRow = Tables<"sale_returns">;

/** `ref` estável por devolução — o que torna `emit()` idempotente por devolução. */
export function saleReturnFiscalRef(saleReturnId: string): string {
  return `devolucao-${saleReturnId}`;
}

export type SaleReturnListRow = {
  id: string;
  code: string;
  saleId: string;
  saleCode: string;
  clientName: string;
  reason: string;
  status: SaleReturnRow["status"];
  total: number;
  issueDate: string;
  operatorName: string;
  itemCount: number;
};

/** As devoluções da filial, com a venda de origem e o cliente resolvidos por join. */
export async function fetchSaleReturns(branchId: string): Promise<SaleReturnListRow[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("sale_returns")
    .select(
      `id, code, sale_id, reason, status, total_amount, issue_date,
       sale:sales(code, contact:contacts(name)),
       operator:profiles(name),
       items:sale_return_items(id)`,
    )
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    saleId: row.sale_id,
    saleCode: row.sale?.code ?? "—",
    clientName: row.sale?.contact?.name ?? "Sem cliente",
    reason: row.reason,
    status: row.status,
    total: row.total_amount,
    issueDate: row.issue_date,
    operatorName: row.operator?.name ?? "",
    itemCount: row.items?.length ?? 0,
  }));
}

/* ------------------------------------------------------------------------ */
/* Escolher a venda de origem                                               */
/* ------------------------------------------------------------------------ */

export type ReturnableSale = {
  id: string;
  code: string;
  clientName: string;
  issueDate: string;
  total: number;
};

/** Vendas confirmadas da filial, para o operador escolher qual está sendo devolvida. */
export async function fetchReturnableSales(branchId: string, query: string): Promise<ReturnableSale[]> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("search_returnable_sales", {
    p_branch_id: branchId,
    p_term: query.trim(),
  });
  if (error) throw error;
  return (data ?? []).map((sale) => ({
    id: sale.id,
    code: sale.code,
    clientName: sale.client_name,
    issueDate: sale.issue_date,
    total: sale.total_amount,
  }));
}

export type ReturnableSaleItem = {
  saleItemId: string;
  productCode: string;
  productDescription: string;
  quantity: number;
  /** Quanto já foi devolvido desta linha em devoluções anteriores (não canceladas). */
  returnedQuantity: number;
  /** `quantity - returnedQuantity` — o teto desta devolução. */
  remainingQuantity: number;
  unitPrice: number;
  discountAmount: number;
  totalAmount: number;
};

export type ReturnableSaleDetail = {
  saleId: string;
  saleCode: string;
  clientName: string;
  issueDate: string;
  /** Soma dos itens da venda (já líquida do desconto por item) — base do rateio do desconto do cabeçalho. */
  saleSubtotal: number;
  /** Desconto do cabeçalho da venda, rateado proporcionalmente entre as linhas devolvidas. */
  saleDiscount: number;
  items: ReturnableSaleItem[];
  /** Documento fiscal da venda, quando existe — decide quais opções fiscais a tela oferece. */
  invoice: {
    id: string;
    model: "nfe" | "nfce";
    status: Tables<"fiscal_documents">["status"];
    chave: string | null;
  } | null;
};

/**
 * A venda escolhida, com a quantidade **ainda devolvível** de cada linha.
 *
 * O saldo é calculado aqui só para a tela não deixar o operador digitar um
 * número impossível — quem realmente barra é a RPC, que recalcula a mesma
 * soma sob `select ... for update` (duas devoluções simultâneas da mesma
 * linha não podem passar as duas).
 */
export async function fetchReturnableSaleDetail(saleId: string): Promise<ReturnableSaleDetail> {
  const client = assertSupabase();
  const [{ data: sale, error: saleError }, { data: returned, error: returnedError }, { data: invoices, error: invoiceError }] =
    await Promise.all([
      client
        .from("sales")
        .select(
          `id, code, issue_date, subtotal_amount, discount_amount, contact:contacts(name),
           items:sale_items(id, quantity, unit_price, discount_amount, total_amount,
             product:products(code, description))`,
        )
        .eq("id", saleId)
        .single(),
      client
        .from("sale_return_items")
        .select("sale_item_id, quantity, sale_return:sale_returns!inner(status, sale_id)")
        .eq("sale_returns.sale_id", saleId),
      client
        .from("fiscal_documents")
        .select("id, model, status, chave")
        .eq("sale_id", saleId)
        .order("updated_at", { ascending: false }),
    ]);
  if (saleError) throw saleError;
  if (returnedError) throw returnedError;
  if (invoiceError) throw invoiceError;

  const returnedBySaleItem = new Map<string, number>();
  for (const row of returned ?? []) {
    if (row.sale_return?.status === "cancelled") continue;
    returnedBySaleItem.set(row.sale_item_id, (returnedBySaleItem.get(row.sale_item_id) ?? 0) + row.quantity);
  }

  const invoice = (invoices ?? [])[0] ?? null;

  return {
    saleId: sale.id,
    saleCode: sale.code,
    clientName: sale.contact?.name ?? "Sem cliente",
    issueDate: sale.issue_date,
    saleSubtotal: sale.subtotal_amount,
    saleDiscount: sale.discount_amount,
    invoice: invoice
      ? { id: invoice.id, model: invoice.model, status: invoice.status, chave: invoice.chave }
      : null,
    items: (sale.items ?? []).map((item) => {
      const returnedQuantity = returnedBySaleItem.get(item.id) ?? 0;
      return {
        saleItemId: item.id,
        productCode: item.product?.code ?? "",
        productDescription: item.product?.description ?? "",
        quantity: item.quantity,
        returnedQuantity,
        remainingQuantity: Math.max(item.quantity - returnedQuantity, 0),
        unitPrice: item.unit_price,
        discountAmount: item.discount_amount,
        totalAmount: item.total_amount,
      };
    }),
  };
}

/* ------------------------------------------------------------------------ */
/* Criação                                                                  */
/* ------------------------------------------------------------------------ */

export type CreateSaleReturnInput = {
  branchId: string;
  saleId: string;
  reason: string;
  items: { saleItemId: string; quantity: number }[];
};

export async function createSaleReturn(input: CreateSaleReturnInput): Promise<SaleReturnRow> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("create_sale_return", {
    payload: {
      branch_id: input.branchId,
      sale_id: input.saleId,
      reason: input.reason,
      items: input.items.map((item) => ({ sale_item_id: item.saleItemId, quantity: item.quantity })),
    },
  });
  if (error) throw error;
  return data as unknown as SaleReturnRow;
}

/* ------------------------------------------------------------------------ */
/* Dados para a nota de devolução                                           */
/* ------------------------------------------------------------------------ */

/**
 * Monta o que `buildReturnNfePayload` espera: a filial e o cliente vêm da
 * venda original (é ela que a devolução desfaz), os itens são os devolvidos
 * com a quantidade devolvida, e `originalChave` é a chave da nota da venda —
 * nula quando a venda nunca teve nota autorizada.
 */
export async function fetchSaleReturnForInvoice(saleReturnId: string): Promise<SaleReturnForInvoice> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("sale_returns")
    .select(
      `code, issue_date, total_amount,
       sale:sales(code,
         branch:branches(cnpj, name, inscricao_estadual, regime_tributario, logradouro, numero, bairro, municipio, uf, cep),
         contact:contacts(name, document, inscricao_estadual, indicador_ie, logradouro, numero, bairro, municipio, uf, cep, phone),
         invoices:fiscal_documents(status, chave, updated_at)),
       items:sale_return_items(quantity, unit_price, discount_amount, total_amount,
         product:products(code, description, ncm, cest, unidade_comercial, unidade_tributavel, origem_mercadoria, cst_ipi,
           tax_group:tax_groups(id, code, name, cst_icms, csosn, aliquota_icms, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, cst_ibs_cbs, cclasstrib)))`,
    )
    .eq("id", saleReturnId)
    .single();
  if (error) throw error;
  if (!data.sale?.branch) throw new Error("Devolução sem filial associada.");

  const branch = data.sale.branch;
  const contact = data.sale.contact;
  const authorized = (data.sale.invoices ?? []).find((invoice) => invoice.status === "autorizado");

  return {
    code: data.code,
    saleCode: data.sale.code,
    issueDate: data.issue_date,
    totalAmount: data.total_amount,
    discountAmount: (data.items ?? []).reduce((sum, item) => sum + item.discount_amount, 0),
    originalChave: authorized?.chave ?? null,
    branch: {
      cnpj: branch.cnpj,
      name: branch.name,
      inscricaoEstadual: branch.inscricao_estadual,
      regimeTributario: branch.regime_tributario,
      logradouro: branch.logradouro,
      numero: branch.numero,
      bairro: branch.bairro,
      municipio: branch.municipio,
      uf: branch.uf,
      cep: branch.cep,
    },
    contact: contact
      ? {
          name: contact.name,
          document: contact.document,
          inscricaoEstadual: contact.inscricao_estadual,
          indicadorIe: contact.indicador_ie,
          logradouro: contact.logradouro,
          numero: contact.numero,
          bairro: contact.bairro,
          municipio: contact.municipio,
          uf: contact.uf,
          cep: contact.cep,
          phone: contact.phone,
        }
      : null,
    items: (data.items ?? []).map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unit_price,
      discountAmount: item.discount_amount,
      totalAmount: item.total_amount,
      product: {
        code: item.product!.code,
        description: item.product!.description,
        ncm: item.product!.ncm,
        cest: item.product!.cest,
        unidadeComercial: item.product!.unidade_comercial,
        unidadeTributavel: item.product!.unidade_tributavel,
        origemMercadoria: item.product!.origem_mercadoria,
        cstIpi: item.product!.cst_ipi,
        taxGroup: item.product!.tax_group ? toTaxGroup(item.product!.tax_group) : null,
      },
    })),
  };
}

/**
 * O documento fiscal **da devolução** (quando já foi emitido) — leitura
 * pontual, só para a ficha e para os botões "Visualizar"/"Gerar XML" do
 * registro selecionado. Não vale carregar isso junto da lista inteira.
 */
export async function fetchSaleReturnDocument(saleReturnId: string): Promise<InvoiceDocument | null> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("fiscal_documents")
    .select("*")
    .eq("sale_return_id", saleReturnId)
    .maybeSingle();
  if (error) throw error;
  return data ? toInvoiceDocument(data) : null;
}
