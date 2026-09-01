/**
 * **O ponto único onde o front descobre qual provedor fiscal está ativo.**
 *
 * ## Desde A1 (01/09/2026), nenhuma tela chama isto
 *
 * A emissão saiu do navegador: Notas Emitidas, NFC-e do PDV e Devolução falam
 * com a Edge Function `fiscal-emit`, que resolve o provedor do lado dela (lendo
 * `Deno.env`) e é a única que emite de verdade. Este arquivo continua existindo
 * por dois motivos, os dois honestos:
 *
 * - é a borda-navegador do registry compartilhado, o lugar onde uma **prévia**
 *   de nota na tela (fora do escopo de A1) resolveria o provedor;
 * - os scripts de verificação em `scripts/` ainda o carregam — ver o aviso em
 *   `scripts/README.md` sobre o que eles deixaram de provar.
 *
 * **Não volte a emitir por aqui.** Emitir no cliente significa montar a nota com
 * dados que o cliente escolheu, e é exatamente o que A1 fechou.
 *
 * Nenhum módulo pode ter um `if` de provedor: quem precisa de um recebe um
 * `FiscalProvider` pronto de `getFiscalProvider()`.
 *
 * Desde A2 (01/09/2026) a lista de provedores e a regra de fallback moram no
 * núcleo compartilhado (`@fiscal-core/registry.ts`), que roda também na Edge
 * Function. O que continua sendo responsabilidade **deste** arquivo é só o que
 * é específico da borda navegador: ler `import.meta.env.VITE_FISCAL_PROVIDER`
 * (a Edge Function lê `Deno.env`) e guardar a instância única da sessão.
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
 * ## Mudança de comportamento em A2, que vale conhecer
 *
 * `VITE_FISCAL_PROVIDER="focus-nfe"` **não cai mais no simulado**. Até A2 a
 * fábrica do provedor real era `null` e o registry devolvia o simulado com um
 * aviso no console — ou seja, uma configuração pedindo emissão real gerava
 * documento sem valor fiscal, e o único sinal era uma linha de log. Agora o
 * provedor existe como esqueleto e lança `FiscalNotConfiguredError` na
 * operação pedida (até a tarefa A12 plugar a chamada HTTP). Valor **inválido**
 * continua caindo no simulado com aviso — esse fallback é o que protege contra
 * erro de digitação.
 */

import type { FiscalProvider } from "@fiscal-core/provider.ts";
import {
  createFiscalProvider,
  resolveFiscalProviderId,
  type FiscalProviderId,
} from "@fiscal-core/registry.ts";

export type { FiscalProviderId };

let instance: FiscalProvider | null = null;

/**
 * O provedor ativo. Instância única por sessão — o simulado guarda o estado dos
 * documentos em memória, então pedir uma instância nova a cada chamada faria a
 * consulta não achar o que a emissão acabou de emitir.
 */
export function getFiscalProvider(): FiscalProvider {
  if (!instance) {
    const id = resolveFiscalProviderId(import.meta.env.VITE_FISCAL_PROVIDER, (message) =>
      console.warn(message),
    );
    instance = createFiscalProvider(id);
  }
  return instance;
}

/** Só para teste: descarta a instância em cache (e, com ela, o estado simulado). */
export function resetFiscalProvider(): void {
  instance = null;
}
