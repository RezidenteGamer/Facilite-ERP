import { supabase } from "../supabaseClient";
import type { Tables } from "../../types/supabase";
import type { Sale, SalePaymentMethod } from "../../features/sales/sales";

type SaleRow = Tables<"sales">;

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

export function toSale(row: SaleRow): Sale {
  return {
    id: row.id,
    branchId: row.branch_id,
    code: row.code,
    status: row.status,
    contactId: row.contact_id ?? undefined,
    sellerId: row.seller_id,
    address: row.address ?? undefined,
    deliveryAddress: row.delivery_address ?? undefined,
    operationType: row.operation_type ?? undefined,
    department: row.department ?? undefined,
    costCenter: row.cost_center ?? undefined,
    issueDate: row.issue_date,
    exitDate: row.exit_date ?? undefined,
    freightAmount: row.freight_amount,
    discountAmount: row.discount_amount,
    subtotalAmount: row.subtotal_amount,
    totalAmount: row.total_amount,
    createdAt: row.created_at ?? undefined,
    confirmedAt: row.confirmed_at ?? undefined,
    cashSessionId: row.cash_session_id ?? undefined,
  };
}

export type SaleItemInput = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
};

export type SalePaymentInput = {
  method: SalePaymentMethod;
  amount: number;
  installments?: number;
};

export type CreateSaleInput = {
  branchId: string;
  /** Nulo/omitido só faz sentido para o PDV (venda sem cliente identificado) — Realizar Venda/Pedidos exigem escolha na própria UI. */
  contactId?: string | null;
  sellerId: string;
  address?: string;
  deliveryAddress?: string;
  operationType?: string;
  department?: string;
  costCenter?: string;
  issueDate: string;
  exitDate?: string;
  freightAmount?: number;
  discountAmount?: number;
  items: SaleItemInput[];
  payments: SalePaymentInput[];
  /**
   * Vencimento da 1ª parcela e intervalo entre parcelas, aplicados pela RPC
   * às formas parceladas (`credito`/`boleto`). Opcionais de propósito: quando
   * não vêm — PDV, venda à vista, qualquer chamador antigo — a RPC mantém o
   * padrão dela de 30 dias para o primeiro vencimento e 30 de intervalo.
   */
  firstDueDate?: string;
  intervalDays?: number;
};

export function toPayload(input: CreateSaleInput) {
  return {
    branch_id: input.branchId,
    contact_id: input.contactId || null,
    seller_id: input.sellerId,
    address: input.address || null,
    delivery_address: input.deliveryAddress || null,
    operation_type: input.operationType || null,
    department: input.department || null,
    cost_center: input.costCenter || null,
    issue_date: input.issueDate,
    exit_date: input.exitDate || null,
    freight_amount: input.freightAmount ?? 0,
    discount_amount: input.discountAmount ?? 0,
    items: input.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      discount_amount: item.discountAmount ?? 0,
    })),
    payments: input.payments.map((payment) => ({
      method: payment.method,
      amount: payment.amount,
      installments: payment.installments ?? 1,
    })),
    first_due_date: input.firstDueDate || null,
    interval_days: input.intervalDays ?? null,
  };
}

/** Cria a venda inteira (cabeçalho + itens + pagamentos + baixa de estoque) atomicamente via RPC. */
export async function createSale(input: CreateSaleInput): Promise<Sale> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("create_sale", { payload: toPayload(input) });
  if (error) throw error;
  return toSale(data);
}
