/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Provedor de emissão fiscal ativo — ver `src/lib/fiscal/provider.ts`. */
  readonly VITE_FISCAL_PROVIDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
