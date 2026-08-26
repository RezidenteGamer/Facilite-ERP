import { useCallback, useEffect, useState } from "react";
import {
  fetchStockMovements,
  STOCK_MOVEMENTS_PAGE_SIZE,
  type StockMovement,
} from "../../lib/repositories/stockMovementsRepository";

/**
 * Carrega o livro de movimentações de estoque de uma filial, da mais recente
 * para a mais antiga, em páginas de `STOCK_MOVEMENTS_PAGE_SIZE`.
 *
 * Diferente de `useStockAdjustmentsData`, só lê — não existe "criar
 * movimentação": toda linha nasce de uma venda/compra/condicional/devolução/
 * ajuste feita no módulo correspondente.
 */
export function useStockMovementsData(branchId: string | null) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Uma página cheia pode ter mais atrás dela; uma página curta é o fim da lista. */
  const [hasMore, setHasMore] = useState(false);

  const reload = useCallback(async () => {
    if (!branchId) {
      setMovements([]);
      setHasMore(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchStockMovements(branchId);
      setMovements(rows);
      setHasMore(rows.length === STOCK_MOVEMENTS_PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar as movimentações de estoque.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Anexa a próxima página ao fim da lista, sem recarregar o que já está na tela. */
  const loadMore = useCallback(async () => {
    if (!branchId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const rows = await fetchStockMovements(branchId, { offset: movements.length });
      setMovements((current) => [...current, ...rows]);
      setHasMore(rows.length === STOCK_MOVEMENTS_PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar mais movimentações.");
    } finally {
      setLoadingMore(false);
    }
  }, [branchId, hasMore, loadingMore, movements.length]);

  return { movements, loading, loadingMore, hasMore, error, reload, loadMore };
}
