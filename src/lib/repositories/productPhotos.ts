import { supabase } from "../supabaseClient";

const BUCKET = "product-photos";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

/** Envia a foto de um produto para o Storage e retorna a URL pública. */
export async function uploadProductPhoto(productId: string, file: File): Promise<string> {
  const client = assertSupabase();
  const extension = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
  const path = `${productId}/${Date.now()}.${extension}`;

  const { error } = await client.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: true,
  });
  if (error) throw error;

  const { data } = client.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
