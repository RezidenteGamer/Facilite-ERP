/**
 * Reexport do núcleo compartilhado — ver
 * `supabase/functions/_shared/fiscal/accessKey.ts`.
 *
 * O arquivo saiu daqui em A2 (01/09/2026), quando o núcleo fiscal passou a
 * rodar nas duas bordas (Edge Function em Deno e front). Esta camada fina
 * existe para quem já importava de `src/lib/fiscal/*` não precisar mudar.
 */
export * from "@fiscal-core/accessKey.ts";
