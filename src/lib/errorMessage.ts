/**
 * Mensagem legível a partir de um erro qualquer.
 *
 * Existe porque **nem tudo que é lançado neste projeto é `Error`**: um
 * `PostgrestError` do supabase-js é um objeto simples com `message`, e um
 * `TypeError` de `fetch` que falhou por rede é `Error` mas com mensagem
 * inútil. `err instanceof Error ? err.message : fallback` — a forma óbvia —
 * engole a mensagem do banco justamente no caso em que ela é a única pista.
 *
 * A função nasceu duplicada em `useSaleDraft.ts`, `useInvoicesData.ts`,
 * Financeiro e Controle de Caixa; a partir de A1 (01/09/2026), quando a
 * emissão fiscal passou a atravessar `fetch` para a Edge Function, ela virou
 * um lugar só. `useInvoicesData.ts` reexporta para quem já importava de lá.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return fallback;
}
