import { supabase } from "../supabaseClient";
import type { Tables } from "../../types/supabase";
import type { SaleOrder } from "../../features/sales/saleOrders";
import type { SalePaymentMethod } from "../../features/sales/sales";

type SaleOrderRow = Tables<"sale_orders"> & {
  contact?: { name: string } | null;
  seller?: { name: string } | null;
};

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

function toSaleOrder(row: SaleOrderRow): SaleOrder {
  return {
    id: row.id,
    branchId: row.branch_id,
    code: row.code,
    status: row.status,
    contactId: row.contact_id,
    contactName: row.contact?.name ?? "",
    sellerId: row.seller_id,
    sellerName: row.seller?.name ?? "",
    paymentMethod: row.payment_method,
    installments: row.installments,
    address: row.address ?? undefined,
    deliveryAddress: row.delivery_address ?? undefined,
    operationType: row.operation_type ?? undefined,
    department: row.department ?? undefined,
    costCenter: row.cost_center ?? undefined,
    issueDate: row.issue_date,
    freightAmount: row.freight_amount,
    discountAmount: row.discount_amount,
    subtotalAmount: row.subtotal_amount,
    totalAmount: row.total_amount,
    convertedSaleId: row.converted_sale_id ?? undefined,
    createdAt: row.created_at ?? undefined,
  };
}

/** Lista os pedidos de venda da filial, já com nome de cliente/vendedor (join). */
export async function listSaleOrders(branchId: string): Promise<SaleOrder[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("sale_orders")
    .select("*, contact:contacts(name), seller:profiles!sale_orders_seller_id_fkey(name)")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => toSaleOrder(row as SaleOrderRow));
}

export type SaleOrderItemInput = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
};

export type CreateSaleOrderInput = {
  branchId: string;
  contactId: string;
  sellerId: string;
  paymentMethod: SalePaymentMethod;
  installments: number;
  address?: string;
  deliveryAddress?: string;
  operationType?: string;
  department?: string;
  costCenter?: string;
  issueDate: string;
  freightAmount?: number;
  discountAmount?: number;
  items: SaleOrderItemInput[];
};

function toPayload(input: CreateSaleOrderInput) {
  return {
    branch_id: input.branchId,
    contact_id: input.contactId,
    seller_id: input.sellerId,
    payment_method: input.paymentMethod,
    installments: input.installments,
    address: input.address || null,
    delivery_address: input.deliveryAddress || null,
    operation_type: input.operationType || null,
    department: input.department || null,
    cost_center: input.costCenter || null,
    issue_date: input.issueDate,
    freight_amount: input.freightAmount ?? 0,
    discount_amount: input.discountAmount ?? 0,
    items: input.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      discount_amount: item.discountAmount ?? 0,
    })),
  };
}

/** Cria o pedido inteiro (cabeçalho + itens) atomicamente via RPC — sem baixar estoque. */
export async function createSaleOrder(input: CreateSaleOrderInput): Promise<SaleOrder> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("create_sale_order", { payload: toPayload(input) });
  if (error) throw error;
  return toSaleOrder(data as SaleOrderRow);
}

/** Converte um pedido em aberto numa venda de verdade (via `create_sale`) — é aí que o estoque baixa. */
export async function convertSaleOrderToSale(saleOrderId: string): Promise<{ id: string; code: string }> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("convert_sale_order_to_sale", { p_sale_order_id: saleOrderId });
  if (error) throw error;
  return { id: data.id, code: data.code };
}
