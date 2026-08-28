/**
 * Busca de códigos NCM para o `SearchCombobox` do campo "NCM" em Produtos —
 * mesmo papel de `taxGroupLookups.ts` para o Grupo tributário. `ncm_codes` é
 * só tabela de referência (Receita Federal/Siscomex, ~10,5 mil códigos de 8
 * dígitos vigentes): não tem tela de cadastro própria, só esta consulta.
 */
import { supabase } from "../supabaseClient";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

export type NcmCode = {
  codigo: string;
  descricao: string;
};

function toNcmCode(row: { codigo: string; descricao: string }): NcmCode {
  return { codigo: row.codigo, descricao: row.descricao };
}

/** Busca por código (prefixo) ou trecho da descrição. Sem termo, devolve os primeiros 20 por código. */
export async function fetchNcmCodes(query: string): Promise<NcmCode[]> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("search_ncm_codes", { p_term: query.trim() });
  if (error) throw error;
  return (data ?? []).map(toNcmCode);
}
