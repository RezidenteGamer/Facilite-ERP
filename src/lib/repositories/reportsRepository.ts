/**
 * Leitura dos dados por trás dos 12 blocos de Relatórios (etapa 11).
 *
 * As consultas por entidade (cliente/fornecedor/produto) leem das views
 * `report_*_day` — grão por dia, não só por entidade, para permitir filtro de
 * intervalo de datas arbitrário sem parametrizar a view (ver a migration
 * `create_reports_views` para a explicação completa de `security_invoker`).
 * Este arquivo faz o filtro de data (`.gte()/.lte()` em cima da view) e o
 * segundo agrupamento, por entidade, em JS — sobre um resultado que já veio
 * agregado por dia do banco, não sobre linhas cruas.
 *
 * "Notas fiscais emitidas" e "Estoque abaixo do mínimo" não agregam nada
 * (é filtro + ordenação), então leem direto das tabelas (`fiscal_documents`/
 * `products`), sem view — a mesma RLS de sempre já basta.
 */
import { supabase } from "../supabaseClient";
import type { Tables } from "../../types/supabase";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

export type DateRange = { from: string; to: string };

/** Linha diária de `report_sales_by_day` — usada por "Vendas (Total Faturado)" e "Vendas por período". */
export type SalesByDayRow = { saleDate: string; saleCount: number; totalAmount: number };

export async function fetchSalesByDay(branchId: string, range: DateRange): Promise<SalesByDayRow[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("report_sales_by_day")
    .select("sale_date, sale_count, total_amount")
    .eq("branch_id", branchId)
    .gte("sale_date", range.from)
    .lte("sale_date", range.to)
    .order("sale_date", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    saleDate: row.sale_date ?? "",
    saleCount: row.sale_count ?? 0,
    totalAmount: row.total_amount ?? 0,
  }));
}

/** "Vendas por cliente" — soma por `contact_id` as linhas diárias já filtradas pelo intervalo. */
export type SalesByContactRow = {
  contactId: string | null;
  contactName: string;
  saleCount: number;
  totalAmount: number;
};

export async function fetchSalesByContact(
  branchId: string,
  range: DateRange,
  contactIds: string[] = [],
): Promise<SalesByContactRow[]> {
  const client = assertSupabase();
  let query = client
    .from("report_sales_by_contact_day")
    .select("contact_id, contact_name, sale_date, sale_count, total_amount")
    .eq("branch_id", branchId)
    .gte("sale_date", range.from)
    .lte("sale_date", range.to);
  if (contactIds.length > 0) query = query.in("contact_id", contactIds);
  const { data, error } = await query;
  if (error) throw error;

  const byContact = new Map<string, SalesByContactRow>();
  for (const row of data ?? []) {
    const key = row.contact_id ?? "sem-cliente";
    const current = byContact.get(key) ?? {
      contactId: row.contact_id,
      // RLS de `contacts` é separada da de `sales` — sem permissão em
      // Clientes e Fornecedores, `contact_name` chega nulo mesmo com o
      // `contact_id` presente (camada 2, mesmo espírito do bloco Financeiro).
      contactName: row.contact_id ? (row.contact_name ?? "Cliente sem permissão de leitura") : "Consumidor final",
      saleCount: 0,
      totalAmount: 0,
    };
    current.saleCount += row.sale_count ?? 0;
    current.totalAmount += row.total_amount ?? 0;
    byContact.set(key, current);
  }
  return Array.from(byContact.values()).sort((a, b) => b.totalAmount - a.totalAmount);
}

/** "Vendas por produto" e "Produtos mais vendidos" — mesma fonte, ordenação decidida por quem chama. */
export type SaleItemsByProductRow = {
  productId: string | null;
  productCode: string;
  productDescription: string;
  quantity: number;
  totalAmount: number;
};

export async function fetchSaleItemsByProduct(
  branchId: string,
  range: DateRange,
  productIds: string[] = [],
): Promise<SaleItemsByProductRow[]> {
  const client = assertSupabase();
  let query = client
    .from("report_sale_items_by_product_day")
    .select("product_id, product_code, product_description, sale_date, quantity, total_amount")
    .eq("branch_id", branchId)
    .gte("sale_date", range.from)
    .lte("sale_date", range.to);
  if (productIds.length > 0) query = query.in("product_id", productIds);
  const { data, error } = await query;
  if (error) throw error;

  const byProduct = new Map<string, SaleItemsByProductRow>();
  for (const row of data ?? []) {
    const key = row.product_id ?? "produto-removido";
    const current = byProduct.get(key) ?? {
      productId: row.product_id,
      productCode: row.product_code ?? "—",
      productDescription: row.product_description ?? "Produto sem permissão de leitura",
      quantity: 0,
      totalAmount: 0,
    };
    current.quantity += row.quantity ?? 0;
    current.totalAmount += row.total_amount ?? 0;
    byProduct.set(key, current);
  }
  return Array.from(byProduct.values());
}

/** "Compras por fornecedor". */
export type PurchasesByContactRow = {
  contactId: string | null;
  contactName: string;
  purchaseCount: number;
  totalAmount: number;
};

export async function fetchPurchasesByContact(
  branchId: string,
  range: DateRange,
  contactIds: string[] = [],
): Promise<PurchasesByContactRow[]> {
  const client = assertSupabase();
  let query = client
    .from("report_purchases_by_contact_day")
    .select("contact_id, contact_name, purchase_date, purchase_count, total_amount")
    .eq("branch_id", branchId)
    .gte("purchase_date", range.from)
    .lte("purchase_date", range.to);
  if (contactIds.length > 0) query = query.in("contact_id", contactIds);
  const { data, error } = await query;
  if (error) throw error;

  const byContact = new Map<string, PurchasesByContactRow>();
  for (const row of data ?? []) {
    const key = row.contact_id ?? "sem-fornecedor";
    const current = byContact.get(key) ?? {
      contactId: row.contact_id,
      contactName: row.contact_name ?? "Fornecedor sem permissão de leitura",
      purchaseCount: 0,
      totalAmount: 0,
    };
    current.purchaseCount += row.purchase_count ?? 0;
    current.totalAmount += row.total_amount ?? 0;
    byContact.set(key, current);
  }
  return Array.from(byContact.values()).sort((a, b) => b.totalAmount - a.totalAmount);
}

/**
 * "Produtos comprados" e "Custo médio de compras" — mesma fonte.
 * `avgUnitCost` é ponderado pelo total filtrado (`costAmount / quantity`),
 * calculado aqui e não como média de médias diárias (que seria errada).
 */
export type PurchaseItemsByProductRow = {
  productId: string | null;
  productCode: string;
  productDescription: string;
  quantity: number;
  totalAmount: number;
  avgUnitCost: number | null;
};

export async function fetchPurchaseItemsByProduct(
  branchId: string,
  range: DateRange,
  productIds: string[] = [],
): Promise<PurchaseItemsByProductRow[]> {
  const client = assertSupabase();
  let query = client
    .from("report_purchase_items_by_product_day")
    .select("product_id, product_code, product_description, purchase_date, quantity, total_amount, cost_amount")
    .eq("branch_id", branchId)
    .gte("purchase_date", range.from)
    .lte("purchase_date", range.to);
  if (productIds.length > 0) query = query.in("product_id", productIds);
  const { data, error } = await query;
  if (error) throw error;

  const byProduct = new Map<string, { row: PurchaseItemsByProductRow; costAmount: number }>();
  for (const row of data ?? []) {
    const key = row.product_id ?? "produto-removido";
    const current = byProduct.get(key) ?? {
      row: {
        productId: row.product_id,
        productCode: row.product_code ?? "—",
        productDescription: row.product_description ?? "Produto sem permissão de leitura",
        quantity: 0,
        totalAmount: 0,
        avgUnitCost: null,
      },
      costAmount: 0,
    };
    current.row.quantity += row.quantity ?? 0;
    current.row.totalAmount += row.total_amount ?? 0;
    current.costAmount += row.cost_amount ?? 0;
    byProduct.set(key, current);
  }
  return Array.from(byProduct.values()).map(({ row, costAmount }) => ({
    ...row,
    avgUnitCost: row.quantity > 0 ? costAmount / row.quantity : null,
  }));
}

/** "Notas fiscais emitidas" — filtro por modelo/status, sem agregação: direto da tabela. */
export type FiscalDocumentReportRow = {
  id: string;
  saleCode: string | null;
  model: Tables<"fiscal_documents">["model"];
  status: Tables<"fiscal_documents">["status"];
  chave: string | null;
  numero: string | null;
  createdAt: string;
};

export async function fetchFiscalDocumentsReport(
  branchId: string,
  filters: { model?: "nfe" | "nfce"; status?: Tables<"fiscal_documents">["status"] },
): Promise<FiscalDocumentReportRow[]> {
  const client = assertSupabase();
  let query = client
    .from("fiscal_documents")
    .select("id, model, status, chave, numero, created_at, sale:sales(code)")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false });
  if (filters.model) query = query.eq("model", filters.model);
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    saleCode: row.sale?.code ?? null,
    model: row.model,
    status: row.status,
    chave: row.chave,
    numero: row.numero,
    createdAt: row.created_at,
  }));
}

/** "Estoque abaixo do mínimo" — filtro simples, sem agregação: direto da tabela. */
export type LowStockProductRow = {
  id: string;
  code: string;
  description: string;
  stock: number;
  minimumStock: number;
};

export async function fetchLowStockProducts(branchId: string): Promise<LowStockProductRow[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("products")
    .select("id, code, description, stock, minimum_stock")
    .eq("branch_id", branchId)
    .not("minimum_stock", "is", null)
    .order("code", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((row) => row.minimum_stock !== null && row.stock < row.minimum_stock)
    .map((row) => ({
      id: row.id,
      code: row.code,
      description: row.description,
      stock: row.stock,
      minimumStock: row.minimum_stock as number,
    }));
}
