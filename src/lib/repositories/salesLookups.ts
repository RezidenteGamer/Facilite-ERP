import { supabase } from "../supabaseClient";
import type { Contact } from "../../features/customers/contacts";
import { fetchContactsByKind } from "./contactLookups";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

export type SaleSeller = {
  id: string;
  name: string;
  operatorCode: string;
};

/** Busca clientes (contacts kind=clientes) por nome ou documento — usado no lookup de Cliente. */
export function fetchSaleContacts(query: string): Promise<Contact[]> {
  return fetchContactsByKind("clientes", query);
}

/** Busca vendedores (profiles ativos) por nome — usado no lookup de Vendedor. */
export async function fetchSaleSellers(query: string): Promise<SaleSeller[]> {
  const client = assertSupabase();
  let request = client.from("profiles").select("id, name, operator_code").eq("active", true).order("name");
  const term = query.trim();
  if (term) {
    request = request.ilike("name", `%${term}%`);
  }
  const { data, error } = await request.limit(20);
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, name: row.name, operatorCode: row.operator_code }));
}
