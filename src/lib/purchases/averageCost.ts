/**
 * Custo médio ponderado do estoque após uma linha de compra — mesma fórmula
 * gravada em `create_purchase` (D3, ver
 * `supabase/migrations/00000000000016_d3_custo_medio_ponderado.sql`).
 * Mantida aqui como espelho testável: o SQL da RPC não roda em Vitest, e é
 * esta conta que decide `products.average_cost` a cada compra.
 *
 * `stockBefore`/`averageCostBefore` refletem o produto ANTES da linha ser
 * aplicada. `averageCostBefore` nulo/indefinido (produto que nunca teve
 * média) é tratado como 0 só dentro da conta — não como se fosse
 * `unitCost` por atribuição direta; a fórmula já resolve isso sozinha
 * quando `stockBefore` é 0.
 *
 * Quando `stockBefore + quantity <= 0` (só possível com estoque negativo
 * habilitado), não há proporção positiva para calcular uma média sobre — o
 * novo custo unitário vira a média, por ser o único fato disponível sobre o
 * que está fisicamente entrando no estoque.
 */
export function calculateWeightedAverageCost(
  stockBefore: number,
  averageCostBefore: number | null | undefined,
  quantity: number,
  unitCost: number,
): number {
  const totalStock = stockBefore + quantity;
  if (totalStock <= 0) return unitCost;
  const avgBefore = averageCostBefore ?? 0;
  return (stockBefore * avgBefore + quantity * unitCost) / totalStock;
}
