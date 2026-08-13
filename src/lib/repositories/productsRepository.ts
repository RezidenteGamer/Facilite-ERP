import { supabase } from "../supabaseClient";
import type { Tables, TablesInsert, TablesUpdate } from "../../types/supabase";
import type { Product } from "../../features/products/products";
import type { ModuleDataRepository } from "./types";

type ProductRow = Tables<"products">;

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

function toProduct(row: ProductRow): Product {
  return {
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
  };
}

function toUpdateRow(patch: Partial<Product>): TablesUpdate<"products"> {
  return {
    ...(patch.code !== undefined && { code: patch.code }),
    ...(patch.description !== undefined && { description: patch.description }),
    ...(patch.stock !== undefined && { stock: patch.stock }),
    ...(patch.salePrice !== undefined && { sale_price: patch.salePrice }),
    ...(patch.active !== undefined && { active: patch.active }),
    ...(patch.taxation !== undefined && { taxation: patch.taxation || null }),
    ...(patch.type !== undefined && { type: patch.type || null }),
    ...(patch.costPrice !== undefined && { cost_price: patch.costPrice ?? null }),
    ...(patch.wholesalePrice !== undefined && { wholesale_price: patch.wholesalePrice ?? null }),
    ...(patch.ncm !== undefined && { ncm: patch.ncm || null }),
    ...(patch.location !== undefined && { location: patch.location || null }),
    ...(patch.subLocation !== undefined && { sub_location: patch.subLocation || null }),
  };
}

/** Busca o próximo código sequencial (ex: "001" -> "002") dentro de uma filial. */
async function nextProductCode(branchId: string): Promise<string> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("products")
    .select("code")
    .eq("branch_id", branchId)
    .order("code", { ascending: false })
    .limit(1);
  if (error) throw error;

  const lastCode = data?.[0]?.code;
  const nextNumber = lastCode ? Number.parseInt(lastCode, 10) + 1 : 1;
  return String(nextNumber).padStart(3, "0");
}

/**
 * Repositório de produtos para uma filial fixa. Implementa
 * `ModuleDataRepository<Product>` para a engine genérica de metadados.
 */
export function createProductsRepository(branchId: string): ModuleDataRepository<Product> {
  return {
    async list() {
      const client = assertSupabase();
      const { data, error } = await client
        .from("products")
        .select("*")
        .eq("branch_id", branchId)
        .order("code", { ascending: true });
      if (error) throw error;
      return (data ?? []).map(toProduct);
    },

    async create(input) {
      const client = assertSupabase();
      const code = await nextProductCode(branchId);
      const row: TablesInsert<"products"> = {
        branch_id: branchId,
        code,
        description: input.description,
        stock: input.stock,
        sale_price: input.salePrice,
        active: input.active,
        taxation: input.taxation || null,
        type: input.type || null,
        cost_price: input.costPrice ?? null,
        wholesale_price: input.wholesalePrice ?? null,
        ncm: input.ncm || null,
        location: input.location || null,
        sub_location: input.subLocation || null,
      };
      const { data, error } = await client.from("products").insert(row).select().single();
      if (error) throw error;
      return toProduct(data);
    },

    async update(id, patch) {
      const client = assertSupabase();
      const { data, error } = await client
        .from("products")
        .update(toUpdateRow(patch))
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return toProduct(data);
    },

    async remove(id) {
      const client = assertSupabase();
      const { error } = await client.from("products").delete().eq("id", id);
      if (error) throw error;
    },
  };
}
