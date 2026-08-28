import { supabase } from "../supabaseClient";
import type { Contact, ContactKind } from "../../features/customers/contacts";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

/**
 * Busca contatos ativos de um tipo (clientes ou fornecedores) por nome ou
 * documento — alimenta o `LookupModal` de qualquer tela que precise escolher
 * um contato (venda, pedido, lançamento financeiro).
 */
export async function fetchContactsByKind(kind: ContactKind, query: string): Promise<Contact[]> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("search_contacts_by_kind", { p_kind: kind, p_term: query.trim() });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    document: row.document,
    active: row.active,
    isFavorite: row.is_favorite,
    logradouro: row.logradouro ?? undefined,
    numero: row.numero ?? undefined,
    bairro: row.bairro ?? undefined,
    municipio: row.municipio ?? undefined,
    uf: row.uf ?? undefined,
    cep: row.cep ?? undefined,
    rg: row.rg ?? undefined,
    birthDate: row.birth_date ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    whatsapp: row.whatsapp ?? undefined,
    createdAt: row.created_at ?? undefined,
    photoUrl: row.photo_url ?? undefined,
    inscricaoEstadual: row.inscricao_estadual ?? undefined,
    indicadorIe: row.indicador_ie ?? undefined,
    codigoIbgeMunicipio: row.codigo_ibge_municipio ?? undefined,
  }));
}
