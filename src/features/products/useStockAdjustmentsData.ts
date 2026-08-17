import { useCallback, useEffect, useState } from "react";
import {
  createStockAdjustmentsRepository,
  type StockAdjustment,
  type StockAdjustmentBatchItem,
} from "../../lib/repositories/stockAdjustmentsRepository";

/** Carrega o histórico e grava lotes de ajuste de uma filial, com estado de loading/erro. */
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
      const repository = createStockAdjustmentsRepository(branchId);
      const rows = await repository.list({});
      setAdjustments(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar os ajustes de estoque.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Grava o lote inteiro numa transação só (RPC `adjust_stock_batch`) e recarrega. */
  async function createAdjustmentBatch(items: StockAdjustmentBatchItem[]) {
    if (!branchId) throw new Error("Selecione uma filial antes de ajustar o estoque.");
    const repository = createStockAdjustmentsRepository(branchId);
    await repository.createBatch(items);
    await reload();
  }

  return { adjustments, loading, error, reload, createAdjustmentBatch };
}
