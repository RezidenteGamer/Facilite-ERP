/**
 * Leitura do livro de movimentações de estoque (`stock_movements_view`).
 *
 * A view é só leitura e não altera nenhuma RPC: ela soma o que
 * `create_sale`/`create_purchase`/`create_conditional`/`create_sale_return`/
 * `adjust_stock_batch` — mais `register_conditional_return` e
 * `cancel_conditional` — já gravam hoje. A explicação completa de cada
 * `union all`, incluindo os três casos que não são óbvios olhando só as
 * tabelas de itens, está no comentário da migration `create_stock_movements_view`.
 *
 * Permissão: a view é gatilhada por `has_permission('ajuste-estoque','view')`
 * + `has_branch_access(branch_id)` dentro do próprio SQL — sem isso ela
 * devolve zero linhas, não importa o filtro que este arquivo mande.
 */
import { supabase } from "../supabaseClient";

/** Tipos de movimento que a view emite. Um por caminho que mexe em `products.stock`. */
export type StockMovementType =
  | "venda"
  | "compra"
  | "condicional"
  | "devolucao-condicional"
  | "condicional-cancelada"
  | "devolucao"
  | "ajuste";

export type StockMovement = {
  id: string;
  productId: string;
  productCode: string;
  productDescription: string;
  /** Já vem com o sinal certo da view: negativo é saída, positivo é entrada. */
  quantityDelta: number;
  movementType: StockMovementType;
  /** Código do documento de origem (venda/compra/condicional/devolução) ou o motivo do ajuste. */
  originCode: string;
  occurredAt: string;
};

/**
 * Teto de linhas por consulta. A lista cresce com o tempo (uma linha por item
 * de cada venda/compra/condicional/devolução/ajuste da filial), então nunca
 * se traz tudo — a tela mostra a janela mais recente e avisa quando o limite
 * foi atingido.
 */
export const STOCK_MOVEMENTS_PAGE_SIZE = 200;

/** Rótulo em português de cada tipo, para a coluna "Tipo de movimento". */
export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  venda: "Venda",
  compra: "Compra",
  condicional: "Condicional (saída)",
  "devolucao-condicional": "Devolução de condicional",
  "condicional-cancelada": "Condicional cancelada",
  devolucao: "Devolução de venda",
  ajuste: "Ajuste manual",
};

export function stockMovementLabel(type: string): string {
  return STOCK_MOVEMENT_LABELS[type as StockMovementType] ?? type;
}

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

export type FetchStockMovementsOptions = {
  /** Quantas linhas trazer. Sem isso, `STOCK_MOVEMENTS_PAGE_SIZE`. */
  limit?: number;
  /** Quantas linhas pular — a tela usa para o botão "Carregar mais". */
  offset?: number;
};

/**
 * Movimentações de uma filial, da mais recente para a mais antiga.
 *
 * O desempate por `id` depois de `occurred_at` importa: um lote de ajuste ou
 * uma venda com vários itens grava várias linhas no mesmo instante, e sem o
 * segundo critério a ordem entre elas mudaria de uma consulta para outra —
 * o que faria a paginação repetir ou pular linhas.
 */
export async function fetchStockMovements(
  branchId: string,
  { limit = STOCK_MOVEMENTS_PAGE_SIZE, offset = 0 }: FetchStockMovementsOptions = {},
): Promise<StockMovement[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("stock_movements_view")
    .select(
      "id, product_id, product_code, product_description, quantity_delta, movement_type, origin_code, occurred_at",
    )
    .eq("branch_id", branchId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id ?? "",
    productId: row.product_id ?? "",
    productCode: row.product_code ?? "",
    // A view faz `left join products`: produto apagado depois do movimento
    // deixa a linha viva, só sem nome — a movimentação aconteceu de verdade.
    productDescription: row.product_description ?? "Produto removido",
    quantityDelta: Number(row.quantity_delta ?? 0),
    movementType: (row.movement_type ?? "ajuste") as StockMovementType,
    originCode: row.origin_code ?? "",
    occurredAt: row.occurred_at ?? "",
  }));
}
