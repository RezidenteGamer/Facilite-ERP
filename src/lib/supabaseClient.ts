import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * `null` até as variáveis VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY existirem
 * (ver .env.example). Nenhuma tela deve importar isto assumindo que não é nulo.
 */
export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey)
  : null;
