import { supabase } from "../supabaseClient";
import type { Sale } from "../../features/sales/sales";
import { toPayload, toSale, type CreateSaleInput } from "./salesRepository";
import { throwSupabaseError } from "./postgrestFailure";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

/**
 * Cria a venda do PDV via `create_pos_sale` — mesmo formato de payload de
 * `create_sale` (a RPC reaproveita `create_sale` internamente, sem duplicar
 * baixa de estoque/parcelamento), mas exige sessão de caixa aberta na filial
 * e grava `cash_session_id` na venda. Ver decisão no AGENTS.md.
 *
 * Desde E6 (10/09/2026) o erro sai daqui como `SupabaseRequestError`, que
 * carrega se foi **rede** ou **recusa do banco** — a diferença que decide
 * entre guardar a venda na fila offline e mostrar erro ao operador. A
 * `message` continua idêntica à do banco, então `extractErrorMessage` em
 * `usePosSale.ts` não mudou. Ver `postgrestFailure.ts`.
 */
export async function createPosSale(input: CreateSaleInput): Promise<Sale> {
  const client = assertSupabase();
  const { data, error, status } = await client.rpc("create_pos_sale", { payload: toPayload(input) });
  if (error) throwSupabaseError(error, status);
  return toSale(data);
}
