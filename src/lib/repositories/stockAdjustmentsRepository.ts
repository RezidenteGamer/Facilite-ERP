import { supabase } from "../supabaseClient";
import type { Tables } from "../../types/supabase";
import type { ModuleBatchRepository } from "./types";

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

/**
 * Uma linha do histórico de ajustes. As chaves em camelCase são os
 * `accessorKey` que o motor genérico lê a partir de `module_fields`
 * (`product_code` -> `productCode`) — mudar um nome aqui exige mudar a linha
 * correspondente em `module_fields`.
 */
export type StockAdjustment = {
  id: string;
  productId: string;
  productCode: string;
  productDescription: string;
  productCurrentStock: number;
  productCostPrice: number | null;
  productLocation: string;
  productSubLocation: string;
  change: number;
  reason: string;
  balanceAfter: number;
  createdAt: string;
  operatorName: string;
};

/** Um item do lote a gravar. `change` e `countedBalance` são exclusivos entre si. */
export type StockAdjustmentBatchItem = {
  productId: string;
  /** Delta explícito (+10 / -5). Use este OU `countedBalance`, nunca os dois. */
  change?: number;
  /** Saldo contado na prateleira — o delta é calculado dentro da transação da RPC. */
  countedBalance?: number;
  reason: string;
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
    productCostPrice: row.products?.cost_price ?? null,
    productLocation: row.products?.location ?? "",
    productSubLocation: row.products?.sub_location ?? "",
    change: row.change,
    reason: row.reason,
    balanceAfter: row.balance_after,
    createdAt: row.created_at,
    operatorName: row.profiles?.name ?? "",
  };
}

/**
 * Repositório de Ajuste de estoque para uma filial fixa. Implementa
 * `ModuleBatchRepository` (lista + grava em lote) em vez de
 * `ModuleDataRepository`: ajuste é registro de auditoria, não tem
 * editar/excluir individual.
 */
export function createStockAdjustmentsRepository(
  branchId: string,
): ModuleBatchRepository<StockAdjustment, StockAdjustmentBatchItem> {
  return {
    async list() {
      const client = assertSupabase();
      const { data, error } = await client
        .from("stock_adjustments")
        .select(
          "*, products(code, description, stock, cost_price, location, sub_location), profiles(name)",
        )
        .eq("branch_id", branchId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data as StockAdjustmentRow[] | null) ?? []).map(toStockAdjustment);
    },

    async createBatch(items) {
      const client = assertSupabase();
      const { error } = await client.rpc("adjust_stock_batch", {
        p_branch_id: branchId,
        p_items: items.map((item) => ({
          product_id: item.productId,
          change: item.change ?? null,
          counted_balance: item.countedBalance ?? null,
          reason: item.reason,
        })),
      });
      if (error) throw error;
    },
  };
}
