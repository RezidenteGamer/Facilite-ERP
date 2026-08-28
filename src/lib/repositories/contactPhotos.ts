import { supabase } from "../supabaseClient";
import { resizeImageForUpload } from "../imageResize";

const BUCKET = "contact-photos";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

/** Envia a foto de um contato para o Storage e retorna a URL pública. */
export async function uploadContactPhoto(contactId: string, file: File): Promise<string> {
  const client = assertSupabase();
  const resized = await resizeImageForUpload(file);
  const extension = resized.name.includes(".") ? resized.name.split(".").pop() : "jpg";
  const path = `${contactId}/${Date.now()}.${extension}`;

  const { error } = await client.storage.from(BUCKET).upload(path, resized, {
    contentType: resized.type || undefined,
    upsert: true,
  });
  if (error) throw error;

  const { data } = client.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
