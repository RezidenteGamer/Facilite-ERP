import { supabase } from "../supabaseClient";
import type { Sale } from "../../features/sales/sales";
import { toPayload, toSale, type CreateSaleInput } from "./salesRepository";

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
 */
export async function createPosSale(input: CreateSaleInput): Promise<Sale> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("create_pos_sale", { payload: toPayload(input) });
  if (error) throw error;
  return toSale(data);
}
