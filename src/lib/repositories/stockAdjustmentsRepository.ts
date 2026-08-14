import { supabase } from "../supabaseClient";
import type { Tables } from "../../types/supabase";

type StockAdjustmentRow = Tables<"stock_adjustments"> & {
  products: {
    code: string;
    description: string;
    stock: number;
    cost_price: number | null;
    location: string | null;
    sub_location: string | null;
  } | null;
  profiles: { name: string } | null;
};

export type StockAdjustment = {
  id: string;
  productId: string;
  productCode: string;
  productDescription: string;
  productCurrentStock: number;
  productCostPrice?: number;
  productLocation?: string;
  productSubLocation?: string;
  change: number;
  reason: string;
  balanceAfter: number;
  createdAt: string;
  operatorName?: string;
};

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

function toStockAdjustment(row: StockAdjustmentRow): StockAdjustment {
  return {
    id: row.id,
    productId: row.product_id,
    productCode: row.products?.code ?? "",
    productDescription: row.products?.description ?? "",
    productCurrentStock: row.products?.stock ?? row.balance_after,
    productCostPrice: row.products?.cost_price ?? undefined,
    productLocation: row.products?.location ?? undefined,
    productSubLocation: row.products?.sub_location ?? undefined,
    change: row.change,
    reason: row.reason,
    balanceAfter: row.balance_after,
    createdAt: row.created_at,
    operatorName: row.profiles?.name,
  };
}

/** Lista os ajustes de estoque de uma filial, mais recentes primeiro. */
export async function listStockAdjustments(branchId: string): Promise<StockAdjustment[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("stock_adjustments")
    .select("*, products(code, description, stock, cost_price, location, sub_location), profiles(name)")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as StockAdjustmentRow[] | null ?? []).map(toStockAdjustment);
}

export type CreateStockAdjustmentInput = {
  branchId: string;
  productId: string;
  change: number;
  reason: string;
};

/** Ajusta o estoque de um produto e registra a auditoria, atomicamente via RPC `adjust_stock`. */
export async function createStockAdjustment(input: CreateStockAdjustmentInput): Promise<void> {
  const client = assertSupabase();
  const { error } = await client.rpc("adjust_stock", {
    p_branch_id: input.branchId,
    p_product_id: input.productId,
    p_change: input.change,
    p_reason: input.reason,
  });
  if (error) throw error;
}
