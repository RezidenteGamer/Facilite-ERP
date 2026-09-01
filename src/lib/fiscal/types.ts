/**
 * Reexport dos tipos do núcleo compartilhado — ver
 * `supabase/functions/_shared/fiscal/types.ts` (dados) e
 * `supabase/functions/_shared/fiscal/provider.ts` (o contrato e o erro).
 *
 * `export type *` (e não `export *`) porque aqui não há nada em tempo de
 * execução: o arquivo some inteiro na compilação, exatamente como sumia quando
 * os tipos moravam neste diretório.
 */
export type * from "@fiscal-core/types.ts";
export type { FiscalProvider } from "@fiscal-core/provider.ts";
