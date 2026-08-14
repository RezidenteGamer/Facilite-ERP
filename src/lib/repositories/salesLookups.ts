import { supabase } from "../supabaseClient";
import type { Contact } from "../../features/customers/contacts";
import type { Product } from "../../features/products/products";

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
export async function fetchSaleContacts(query: string): Promise<Contact[]> {
  const client = assertSupabase();
  let request = client.from("contacts").select("*").eq("kind", "clientes").eq("active", true).order("name");
  const term = query.trim();
  if (term) {
    request = request.or(`name.ilike.%${term}%,document.ilike.%${term}%`);
  }
  const { data, error } = await request.limit(20);
  if (error) throw error;
  return (data ?? []).map((row) => ({
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
  }));
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

/** Busca produtos ativos da filial por descrição ou código — usado no lookup de Produto. */
export async function fetchSaleProducts(query: string, branchId: string): Promise<Product[]> {
  const client = assertSupabase();
  let request = client
    .from("products")
    .select("*")
    .eq("branch_id", branchId)
    .eq("active", true)
    .order("description");
  const term = query.trim();
  if (term) {
    request = request.or(`description.ilike.%${term}%,code.ilike.%${term}%`);
  }
  const { data, error } = await request.limit(20);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    description: row.description,
    stock: row.stock,
    salePrice: row.sale_price,
    active: row.active,
    taxation: row.taxation ?? undefined,
    type: row.type ?? undefined,
    costPrice: row.cost_price ?? undefined,
    wholesalePrice: row.wholesale_price ?? undefined,
    ncm: row.ncm ?? undefined,
    location: row.location ?? undefined,
    subLocation: row.sub_location ?? undefined,
    createdAt: row.created_at ?? undefined,
  }));
}
