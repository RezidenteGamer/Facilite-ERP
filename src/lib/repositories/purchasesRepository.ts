import { supabase } from "../supabaseClient";
import type { Tables } from "../../types/supabase";
import type { Purchase } from "../../features/purchases/purchases";
import type { SalePaymentMethod } from "../../features/sales/sales";

type PurchaseRow = Tables<"purchases"> & {
  contact?: { name: string } | null;
};

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

function toPurchase(row: PurchaseRow): Purchase {
  return {
    id: row.id,
    branchId: row.branch_id,
    code: row.code,
    status: row.status,
    contactId: row.contact_id,
    contactName: row.contact?.name ?? "",
    paymentMethod: row.payment_method,
    installmentTotal: row.installment_total,
    document: row.document ?? undefined,
    issueDate: row.issue_date,
    entryDate: row.entry_date,
    subtotalAmount: row.subtotal_amount,
    totalAmount: row.total_amount,
    createdAt: row.created_at ?? undefined,
  };
}

/** Lista as compras da filial, já com nome do fornecedor (join). */
export async function listPurchases(branchId: string): Promise<Purchase[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("purchases")
    .select("*, contact:contacts(name)")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => toPurchase(row as PurchaseRow));
}

export type PurchaseItemInput = {
  productId: string;
  quantity: number;
  unitCost: number;
};

export type CreatePurchaseInput = {
  branchId: string;
  contactId: string;
  paymentMethod: SalePaymentMethod;
  /** Só relevante para crédito/boleto/outro — dinheiro/pix/débito nasce em parcela única baixada. */
  installmentCount?: number;
  firstDueDate?: string;
  intervalDays?: number;
  document?: string;
  issueDate: string;
  entryDate: string;
  /** Se marcado, a RPC atualiza products.cost_price de cada item pelo custo pago nesta compra. */
  updateCostPrice: boolean;
  items: PurchaseItemInput[];
};

function toPayload(input: CreatePurchaseInput) {
  return {
    branch_id: input.branchId,
    contact_id: input.contactId,
    payment_method: input.paymentMethod,
    installment_count: input.installmentCount ?? 1,
    first_due_date: input.firstDueDate || null,
    interval_days: input.intervalDays ?? 30,
    document: input.document || null,
    issue_date: input.issueDate,
    entry_date: input.entryDate,
    update_cost_price: input.updateCostPrice,
    items: input.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      unit_cost: item.unitCost,
    })),
  };
}

/** Cria a compra inteira (cabeçalho + itens) atomicamente via RPC — sobe estoque e lança financeiro (a pagar). */
export async function createPurchase(input: CreatePurchaseInput): Promise<Purchase> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("create_purchase", { payload: toPayload(input) });
  if (error) throw error;
  return toPurchase(data as PurchaseRow);
}
