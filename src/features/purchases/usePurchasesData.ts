import { useCallback, useEffect, useState } from "react";
import { listPurchases } from "../../lib/repositories/purchasesRepository";

/** Carrega as compras de uma filial via Supabase, com estado de loading/erro. */
export function usePurchasesData(branchId: string | null) {
  const [purchases, setPurchases] = useState<Awaited<ReturnType<typeof listPurchases>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!branchId) {
      setPurchases([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await listPurchases(branchId);
      setPurchases(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar compras.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { purchases, loading, error, reload };
}
