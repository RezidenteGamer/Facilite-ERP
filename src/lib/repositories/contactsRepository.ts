import { supabase } from "../supabaseClient";
import type { Tables, TablesInsert, TablesUpdate } from "../../types/supabase";
import type { Contact, ContactKind } from "../../features/customers/contacts";
import type { ModuleDataRepository } from "./types";

type ContactRow = Tables<"contacts">;

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    document: row.document,
    active: row.active,
    address: row.address ?? undefined,
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
  };
}

function toUpdateRow(patch: Partial<Contact>): TablesUpdate<"contacts"> {
  return {
    ...(patch.code !== undefined && { code: patch.code }),
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.document !== undefined && { document: patch.document }),
    ...(patch.active !== undefined && { active: patch.active }),
    ...(patch.address !== undefined && { address: patch.address || null }),
    ...(patch.rg !== undefined && { rg: patch.rg || null }),
    ...(patch.birthDate !== undefined && { birth_date: patch.birthDate || null }),
    ...(patch.phone !== undefined && { phone: patch.phone || null }),
    ...(patch.email !== undefined && { email: patch.email || null }),
    ...(patch.whatsapp !== undefined && { whatsapp: patch.whatsapp || null }),
    ...(patch.photoUrl !== undefined && { photo_url: patch.photoUrl || null }),
    ...(patch.inscricaoEstadual !== undefined && { inscricao_estadual: patch.inscricaoEstadual || null }),
    ...(patch.indicadorIe !== undefined && { indicador_ie: patch.indicadorIe || null }),
    ...(patch.codigoIbgeMunicipio !== undefined && {
      codigo_ibge_municipio: patch.codigoIbgeMunicipio || null,
    }),
  };
}

/** Busca o próximo código sequencial (ex: "001" -> "002") dentro de um `kind`. */
async function nextContactCode(kind: ContactKind): Promise<string> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("contacts")
    .select("code")
    .eq("kind", kind)
    .order("code", { ascending: false })
    .limit(1);
  if (error) throw error;

  const lastCode = data?.[0]?.code;
  const nextNumber = lastCode ? Number.parseInt(lastCode, 10) + 1 : 1;
  return String(nextNumber).padStart(3, "0");
}

/**
 * Repositório de contatos para um `kind` fixo (clientes ou fornecedores).
 * Implementa `ModuleDataRepository<Contact>` para que a engine genérica de
 * metadados possa operar sem conhecer nada específico de "Contact".
 */
export function createContactsRepository(kind: ContactKind): ModuleDataRepository<Contact> {
  return {
    async list() {
      const client = assertSupabase();
      const { data, error } = await client
        .from("contacts")
        .select("*")
        .eq("kind", kind)
        .order("code", { ascending: true });
      if (error) throw error;
      return (data ?? []).map(toContact);
    },

    async create(input) {
      const client = assertSupabase();
      const code = await nextContactCode(kind);
      const row: TablesInsert<"contacts"> = {
        kind,
        code,
        name: input.name,
        document: input.document,
        active: input.active,
        address: input.address || null,
        rg: input.rg || null,
        birth_date: input.birthDate || null,
        phone: input.phone || null,
        email: input.email || null,
        whatsapp: input.whatsapp || null,
        inscricao_estadual: input.inscricaoEstadual || null,
        indicador_ie: input.indicadorIe || null,
        codigo_ibge_municipio: input.codigoIbgeMunicipio || null,
      };
      const { data, error } = await client.from("contacts").insert(row).select().single();
      if (error) throw error;
      return toContact(data);
    },

    async update(id, patch) {
      const client = assertSupabase();
      const { data, error } = await client
        .from("contacts")
        .update(toUpdateRow(patch))
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return toContact(data);
    },

    async remove(id) {
      const client = assertSupabase();
      const { error } = await client.from("contacts").delete().eq("id", id);
      if (error) throw error;
    },
  };
}
