import { supabase } from "../supabaseClient";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

/** Lê só o padrão de estoque negativo de uma filial — usado em Configurações e em Produtos (valor efetivo herdado). */
export async function fetchBranchAllowsNegativeStock(branchId: string): Promise<boolean> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("branches")
    .select("allow_negative_stock")
    .eq("id", branchId)
    .single();
  if (error) throw error;
  return data.allow_negative_stock;
}

/** Grava o padrão de estoque negativo da filial. Exige `can_manage_branches` (RLS de `branches update`). */
export async function updateBranchAllowsNegativeStock(branchId: string, allow: boolean): Promise<void> {
  const client = assertSupabase();
  const { error } = await client.from("branches").update({ allow_negative_stock: allow }).eq("id", branchId);
  if (error) throw error;
}
