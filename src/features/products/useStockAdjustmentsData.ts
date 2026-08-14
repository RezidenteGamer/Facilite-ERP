import { useCallback, useEffect, useState } from "react";
import {
  createStockAdjustment,
  listStockAdjustments,
  type CreateStockAdjustmentInput,
  type StockAdjustment,
} from "../../lib/repositories/stockAdjustmentsRepository";

export type NewStockAdjustmentInput = Omit<CreateStockAdjustmentInput, "branchId">;

/** Carrega e cria ajustes de estoque de uma filial via Supabase, com estado de loading/erro. */
export function useStockAdjustmentsData(branchId: string | null) {
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!branchId) {
      setAdjustments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await listStockAdjustments(branchId);
      setAdjustments(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar ajustes de estoque.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function createAdjustment(input: NewStockAdjustmentInput) {
    if (!branchId) throw new Error("Selecione uma filial antes de ajustar o estoque.");
    await createStockAdjustment({ ...input, branchId });
    await reload();
  }

  return { adjustments, loading, error, reload, createAdjustment };
}
