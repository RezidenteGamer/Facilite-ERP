/**
 * `createFocusProvider()` — o esqueleto do provedor real (Focus NFe v2).
 *
 * **Nenhuma chamada HTTP acontece aqui, e isso é o ponto.** Até A2 a entrada
 * `"focus-nfe"` no registry valia `null`, e o efeito prático era: configurar
 * `VITE_FISCAL_PROVIDER=focus-nfe` caía de volta no simulado **com um aviso no
 * console** — ou seja, o sistema seguia emitindo documento sem valor fiscal
 * achando que estava emitindo de verdade, e o único sinal disso era uma linha
 * de log que ninguém lê. Trocar `null` por esta implementação inverte o modo de
 * falha: quem configurar o provedor real sem A12 pronta recebe um erro
 * explícito na cara, na operação exata que tentou.
 *
 * A implementação de verdade é a **tarefa A12**, e ela só começa quando houver
 * cliente pagante (CNPJ + certificado A1 + mensalidade). O que já está decidido
 * e não deve ser redecidido lá:
 *
 * - `emit` é `POST /v2/nfe?ref=<ref>` (ou `/v2/nfce`) com `JSON.stringify` do
 *   `NfePayload` **sem adaptação** — foi para isso que o payload nasceu em
 *   snake_case português, espelhando a grafia da Focus (ver `types.ts`).
 * - `query` é `GET /v2/nfe/<ref>`; `cancel` é `DELETE /v2/nfe/<ref>` com a
 *   justificativa no corpo.
 * - A resposta, ao contrário, **é adaptada** para `FiscalDocument` aqui dentro
 *   — é essa função de adaptação que permite trocar de provedor sem tocar em
 *   Notas Emitidas.
 * - `ref` repetida: a Focus recusa; o adaptador mapeia essa recusa para uma
 *   consulta do `ref` existente, preservando a idempotência que o simulado já
 *   tem.
 * - Rejeição da SEFAZ continua sendo **resultado**, não exceção. Só o
 *   transporte lança.
 *
 * **Os dois métodos de evento ainda precisam de conferência de grafia.** Os
 * campos de emissão foram checados linha a linha contra a tabela completa de
 * campos da Focus na etapa F1; `correctionLetter` e `invalidateRange` foram
 * modelados no formato dos endpoints de evento (`POST /v2/nfe/<ref>/carta_correcao`
 * com `correcao`, e `POST /v2/nfe/inutilizacao` com `cnpj`/`serie`/
 * `numero_inicial`/`numero_final`/`justificativa`) **sem** a mesma conferência.
 * Quem fizer A12 precisa reconferir na documentação antes de mandar o corpo —
 * não assumir que o mapa de nomes daqui está fechado.
 */

import { FiscalNotConfiguredError, type FiscalProvider } from "./provider.ts";
import type {
  FiscalArtifact,
  FiscalCancelRequest,
  FiscalCancelResult,
  FiscalCorrectionRequest,
  FiscalDocument,
  FiscalEmitRequest,
  FiscalEventResult,
  FiscalInvalidateRequest,
} from "./types.ts";

const PROVIDER_ID = "focus-nfe";

const PENDENCIA =
  "A integração com a Focus NFe é a tarefa A12 do plano e ainda não foi implementada. " +
  'Use VITE_FISCAL_PROVIDER="simulado" enquanto isso.';

function naoConfigurado(operation: string): never {
  throw new FiscalNotConfiguredError(PROVIDER_ID, operation, PENDENCIA);
}

/**
 * Devolve um `FiscalProvider` que satisfaz o contrato inteiro e lança
 * `FiscalNotConfiguredError` em todas as sete operações.
 *
 * Os parâmetros das assinaturas existem para o contrato bater, mas nenhum é
 * lido — daí o `void` em cada um, que é o que deixa `noUnusedParameters`
 * satisfeito sem prefixar tudo com `_` e sem deixar a assinatura mentir sobre
 * o que ela recebe quando A12 chegar.
 */
export function createFocusProvider(): FiscalProvider {
  return {
    id: PROVIDER_ID,

    async emit(request: FiscalEmitRequest): Promise<FiscalDocument> {
      void request;
      return naoConfigurado("emit");
    },

    async query(ref: string): Promise<FiscalDocument> {
      void ref;
      return naoConfigurado("query");
    },

    async cancel(request: FiscalCancelRequest): Promise<FiscalCancelResult> {
      void request;
      return naoConfigurado("cancel");
    },

    async correctionLetter(request: FiscalCorrectionRequest): Promise<FiscalEventResult> {
      void request;
      return naoConfigurado("correctionLetter");
    },

    async invalidateRange(request: FiscalInvalidateRequest): Promise<FiscalEventResult> {
      void request;
      return naoConfigurado("invalidateRange");
    },

    async getXml(ref: string): Promise<FiscalArtifact | null> {
      void ref;
      return naoConfigurado("getXml");
    },

    async getDanfe(ref: string): Promise<FiscalArtifact | null> {
      void ref;
      return naoConfigurado("getDanfe");
    },
  };
}
