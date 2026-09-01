/**
 * Busca de grupos tributários para o `LookupModal` — alimenta o campo "Grupo
 * tributário" do formulário de Produtos.
 *
 * Mesmo papel de `contactLookups.ts` (que alimenta o lookup de contato em
 * Realizar Venda/Pedidos/Financeiro): o cadastro do grupo em si roda pela
 * `GenericModulePage` em `/grupos-tributarios`; isto aqui é só a consulta de
 * quem precisa escolher um.
 *
 * `toTaxGroup` (linha crua → `TaxGroup`) morava aqui e mudou para o núcleo
 * compartilhado em A1 (01/09/2026): a Edge Function `fiscal-emit` lê a mesma
 * tabela para montar a nota, e duas conversões significariam um campo novo em
 * `tax_groups` podendo chegar à tela sem chegar ao XML.
 */
import { supabase } from "../supabaseClient";
import { toTaxGroup, type TaxGroup } from "../fiscal/taxGroups";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

/** Busca grupos por código ou nome. Sem termo, devolve os primeiros 20 por código. */
export async function fetchTaxGroups(query: string): Promise<TaxGroup[]> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("search_tax_groups", { p_term: query.trim() });
  if (error) throw error;
  return (data ?? []).map(toTaxGroup);
}
