import { useCallback, useEffect, useState } from "react";
import { convertSaleOrderToSale, listSaleOrders } from "../../lib/repositories/saleOrdersRepository";

/** Carrega os pedidos de venda de uma filial via Supabase, com estado de loading/erro. */
export function useSaleOrdersData(branchId: string | null) {
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof listSaleOrders>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!branchId) {
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await listSaleOrders(branchId);
      setOrders(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar pedidos de venda.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function convertToSale(saleOrderId: string) {
    const sale = await convertSaleOrderToSale(saleOrderId);
    await reload();
    return sale;
  }

  return { orders, loading, error, reload, convertToSale };
}
