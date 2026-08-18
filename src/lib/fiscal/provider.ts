/**
 * **O ponto único onde se decide qual provedor fiscal está ativo.**
 *
 * Nenhum módulo que emite nota (Notas Emitidas, NFC-e, Devolução) pode ter um
 * `if` de provedor: todos chamam `getFiscalProvider()` e recebem um
 * `FiscalProvider`. Quando a etapa de ativação real chegar, trocar o provedor é
 * mudar uma variável de ambiente e acrescentar uma linha em `PROVIDER_FACTORIES`
 * — nenhum arquivo de módulo é tocado. Esse é o critério que essa etapa
 * precisava garantir.
 *
 * ## Por que variável de ambiente, e não linha no banco nem constante
 *
 * - **Constante em código** obrigaria editar e rebuildar para alternar entre
 *   simulado e real, e o mesmo bundle não poderia servir dois ambientes.
 * - **Linha no banco** partiria a configuração em dois lugares: o provedor real
 *   precisa de token e de ambiente (homologação/produção), que são segredo e já
 *   moram no `.env.local` junto das credenciais do Supabase. Guardar o token
 *   numa tabela seria pior; guardar só o nome do provedor no banco e o token no
 *   env deixaria as duas metades podendo divergir.
 * - **Variável de ambiente** é o padrão que o projeto já usa para "com qual
 *   back-end eu falo" (`VITE_SUPABASE_URL`), e mantém provedor e credencial no
 *   mesmo lugar.
 *
 * Falha fechado: valor ausente ou desconhecido cai no simulado. O modo de falha
 * importa — um erro de digitação em `VITE_FISCAL_PROVIDER` no máximo deixa de
 * emitir de verdade; o contrário emitiria nota fiscal real sem querer.
 */

import { createSimulatedFiscalProvider } from "./simulatedFiscalProvider";
import type { FiscalProvider } from "./types";

export type FiscalProviderId = "simulado" | "focus-nfe";

/**
 * Cada provedor implementado, por id. `focus-nfe` ainda não existe — a entrada
 * entra aqui junto com a implementação, na etapa de ativação real (primeiro
 * cliente real, ou etapas 0 a 9 concluídas em modo simulado, o que vier antes).
 */
const PROVIDER_FACTORIES: Record<FiscalProviderId, (() => FiscalProvider) | null> = {
  simulado: () => createSimulatedFiscalProvider(),
  "focus-nfe": null,
};

const DEFAULT_PROVIDER: FiscalProviderId = "simulado";

function resolveConfiguredId(): FiscalProviderId {
  const configured = import.meta.env.VITE_FISCAL_PROVIDER?.trim();
  if (!configured) return DEFAULT_PROVIDER;

  if (!(configured in PROVIDER_FACTORIES)) {
    console.warn(
      `[fiscal] VITE_FISCAL_PROVIDER="${configured}" não é um provedor conhecido. ` +
        `Usando "${DEFAULT_PROVIDER}".`,
    );
    return DEFAULT_PROVIDER;
  }

  const id = configured as FiscalProviderId;
  if (!PROVIDER_FACTORIES[id]) {
    console.warn(
      `[fiscal] O provedor "${id}" ainda não foi implementado. Usando "${DEFAULT_PROVIDER}".`,
    );
    return DEFAULT_PROVIDER;
  }

  return id;
}

let instance: FiscalProvider | null = null;

/**
 * O provedor ativo. Instância única por sessão — o simulado guarda o estado dos
 * documentos em memória, então pedir uma instância nova a cada chamada faria a
 * consulta não achar o que a emissão acabou de emitir.
 */
export function getFiscalProvider(): FiscalProvider {
  if (!instance) {
    const factory = PROVIDER_FACTORIES[resolveConfiguredId()];
    // `resolveConfiguredId` só devolve id com fábrica; o `??` é a garantia de tipo.
    instance = (factory ?? PROVIDER_FACTORIES[DEFAULT_PROVIDER]!)();
  }
  return instance;
}

/** Só para teste: descarta a instância em cache (e, com ela, o estado simulado). */
export function resetFiscalProvider(): void {
  instance = null;
}
