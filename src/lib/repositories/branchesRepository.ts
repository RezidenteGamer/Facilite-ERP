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

/**
 * Lê o `pCredSN` da filial — a alíquota de crédito de ICMS do Simples Nacional
 * (B8, 03/09/2026). Nula quando ninguém cadastrou.
 *
 * O número mora na filial, e não no grupo tributário, porque é o percentual
 * efetivo de ICMS da faixa de RBT12 **dela** — ver a decisão de B8 no
 * AGENTS.md. Quem o usa de verdade é a Edge Function `fiscal-emit`, que o lê do
 * banco na hora de montar a nota; este par de funções existe só para
 * Configurações ter como cadastrá-lo, já que não há módulo de Filiais.
 */
export async function fetchBranchSimplesCreditRate(branchId: string): Promise<number | null> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("branches")
    .select("aliquota_credito_icms_simples")
    .eq("id", branchId)
    .single();
  if (error) throw error;
  return data.aliquota_credito_icms_simples;
}

/** Grava o `pCredSN` da filial (`null` limpa). Exige `can_manage_branches`. */
export async function updateBranchSimplesCreditRate(branchId: string, rate: number | null): Promise<void> {
  const client = assertSupabase();
  const { error } = await client
    .from("branches")
    .update({ aliquota_credito_icms_simples: rate })
    .eq("id", branchId);
  if (error) throw error;
}
