/**
 * **O registry: qual implementação do `FiscalProvider` está ativa.**
 *
 * Nenhum módulo que emite nota (Notas Emitidas, NFC-e, Devolução) pode ter um
 * `if` de provedor — todos recebem um `FiscalProvider` pronto. Este arquivo é
 * quem sabe quais existem e como construir cada um.
 *
 * ## Por que a leitura da variável de ambiente não mora aqui
 *
 * Porque o núcleo roda em duas bordas com formas diferentes de ler
 * configuração: no navegador é `import.meta.env.VITE_FISCAL_PROVIDER` (Vite),
 * na Edge Function é `Deno.env.get(...)`. Um `import.meta.env` aqui quebraria
 * o Deno, e um `Deno.env` quebraria o build do front. Então o registry recebe
 * **o valor já lido** (`resolveFiscalProviderId`) e cada borda faz a leitura
 * do jeito dela — `src/lib/fiscal/provider.ts` no front, e a Edge Function
 * `fiscal-emit` quando A1 a criar.
 *
 * A decisão de a configuração ser variável de ambiente, e não linha no banco
 * nem constante, continua valendo e está registrada no AGENTS.md (etapa F1):
 * o provedor real precisa de token e de ambiente (homologação/produção), que
 * são segredo e já moram no `.env.local` junto das credenciais do Supabase —
 * guardar metade no banco deixaria as duas metades podendo divergir.
 */

import { createFocusProvider } from "./focusProvider.ts";
import type { FiscalProvider } from "./provider.ts";
import {
  createSimulatedFiscalProvider,
  type SimulatedFiscalProviderSeed,
} from "./simulatedFiscalProvider.ts";

export type FiscalProviderId = "simulado" | "focus-nfe";

/**
 * O que a borda pode dizer ao provedor no momento de construí-lo.
 *
 * Hoje só o simulado usa alguma coisa daqui, e de propósito: `simulatedSeed` é
 * o estado que ele **não consegue** guardar entre duas chamadas da Edge
 * Function (ver o cabeçalho de `simulatedFiscalProvider.ts`). Um provedor real
 * guarda o estado do lado dele e ignora o campo — por isso a opção entra aqui,
 * e não no contrato `FiscalProvider`, que descreve operações, não construção.
 */
export type FiscalProviderOptions = {
  simulatedSeed?: SimulatedFiscalProviderSeed;
};

/**
 * Cada provedor conhecido, por id.
 *
 * **Nenhuma entrada vale `null` desde A2.** Até aqui `"focus-nfe"` era `null`
 * e o registry caía no simulado quando alguém a configurava — o que significa
 * que uma configuração pedindo emissão real produzia documento sem valor
 * fiscal, avisando só no console. Agora a entrada existe e é um esqueleto que
 * lança `FiscalNotConfiguredError` (ver `focusProvider.ts`): quem pedir o
 * provedor real antes de A12 recebe um erro explícito, não uma nota simulada.
 */
const PROVIDER_FACTORIES: Record<FiscalProviderId, (options: FiscalProviderOptions) => FiscalProvider> = {
  simulado: (options) => createSimulatedFiscalProvider({ seed: options.simulatedSeed }),
  "focus-nfe": () => createFocusProvider(),
};

export const DEFAULT_FISCAL_PROVIDER_ID: FiscalProviderId = "simulado";

export function isFiscalProviderId(value: string): value is FiscalProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDER_FACTORIES, value);
}

/** Ids conhecidos, para mensagem de erro e para uma tela de configuração listar. */
export function listFiscalProviderIds(): FiscalProviderId[] {
  return Object.keys(PROVIDER_FACTORIES) as FiscalProviderId[];
}

export function createFiscalProvider(
  id: FiscalProviderId,
  options: FiscalProviderOptions = {},
): FiscalProvider {
  return PROVIDER_FACTORIES[id](options);
}

/**
 * Traduz o valor configurado (vindo do ambiente da borda) num id conhecido.
 *
 * **Falha fechado**: valor ausente ou desconhecido cai no simulado. O modo de
 * falha é que decide — um erro de digitação no máximo deixa de emitir de
 * verdade; o contrário emitiria nota fiscal real sem querer. Um valor
 * *conhecido*, ao contrário, é respeitado como está: `"focus-nfe"` devolve o
 * provedor real (hoje, o esqueleto que lança), porque quem escreveu o nome
 * certo está pedindo emissão real de propósito e precisa saber que ela não
 * está pronta — não receber uma nota simulada no lugar.
 *
 * `onUnknown` recebe a mensagem quando há fallback; cada borda decide o que
 * fazer com ela (`console.warn` no front, log estruturado na Edge Function).
 */
export function resolveFiscalProviderId(
  configured: string | null | undefined,
  onUnknown?: (message: string) => void,
): FiscalProviderId {
  const value = configured?.trim();
  if (!value) return DEFAULT_FISCAL_PROVIDER_ID;

  if (!isFiscalProviderId(value)) {
    onUnknown?.(
      `[fiscal] "${value}" não é um provedor conhecido (${listFiscalProviderIds().join(", ")}). ` +
        `Usando "${DEFAULT_FISCAL_PROVIDER_ID}".`,
    );
    return DEFAULT_FISCAL_PROVIDER_ID;
  }

  return value;
}
