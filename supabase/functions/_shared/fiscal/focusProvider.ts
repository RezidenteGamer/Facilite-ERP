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
 * ## O mapa de nomes está fechado (A4, 06/09/2026)
 *
 * O aviso que ficava aqui — "os dois métodos de evento ainda precisam de
 * conferência de grafia" — foi cumprido. A4 conferiu as sete operações contra
 * `doc.focusnfe.com.br` (páginas com `updatedAt` 12/08/2026) e a tabela
 * completa de campos (`campos.focusnfe.com.br/nfe/NotaFiscalXML.html`,
 * `Last-Modified` 22/08/2026), acesso em 06/09/2026. O resumo do que A12 vai
 * usar, já corrigido:
 *
 * | operação           | requisição                                                        |
 * | ------------------ | ----------------------------------------------------------------- |
 * | `emit`             | `POST /v2/nfe?ref=<ref>` (ou `/v2/nfce`), `JSON.stringify(payload)` |
 * | `query`            | `GET /v2/nfe/<ref>` — com `?completa=1` se quiser `protocolo`      |
 * | `cancel`           | `DELETE /v2/nfe/<ref>`, `{ justificativa }` (15 a 255)             |
 * | `correctionLetter` | `POST /v2/nfe/<ref>/carta_correcao`, `{ correcao }` (15 a 1000)    |
 * | `invalidateRange`  | `POST /v2/nfe/inutilizacao`, `{ cnpj, serie, numero_inicial, numero_final, justificativa }` |
 * | `getXml`/`getDanfe`| não têm endpoint próprio — consultar a `ref` e baixar o `caminho_*` |
 *
 * As armadilhas que a conferência achou, cada uma documentada no tipo que a
 * carrega:
 *
 * - **`chave_nfe` vem com o literal `NFe` na frente** (3 letras + 44 dígitos).
 *   O adaptador tira antes de preencher `FiscalDocument.chave`.
 * - **`protocolo` não vem na consulta padrão de NF-e** — só com `?completa=1`.
 *   Na NFC-e o campo existe, mas se chama `numero_protocolo`.
 * - **A carta de correção não devolve protocolo nenhum**, e devolve um PDF
 *   (`caminho_pdf_carta_correcao`) além do XML. A inutilização devolve
 *   `protocolo_sefaz` (não `protocolo`) e `caminho_xml` (não
 *   `caminho_xml_carta_correcao`).
 * - **`status` de evento é `autorizado`/`erro_autorizacao`**, o mesmo par da
 *   emissão. Traduzir para `registrado`/`erro_evento`.
 * - **A inutilização não tem `ref` na Focus.** `FiscalInvalidateRequest.ref` é
 *   identificador nosso e não deduplica nada do lado de lá; os três números
 *   (`serie`, `numero_inicial`, `numero_final`) vão como **string** no corpo.
 * - **NFC-e não tem carta de correção** — não existe endpoint, e o pedido deve
 *   ser recusado antes de sair para a rede. NFC-e também tem prazo de
 *   cancelamento de 30 minutos (NF-e: 24 horas).
 *
 * O que sobrou em aberto — a grafia `items` vs. `itens` da lista de itens, que
 * as duas páginas da Focus escrevem de jeitos diferentes — está anotado em
 * `NfePayload.items` e na entrada de A4 do AGENTS.md, para ser confirmado por
 * tentativa quando A12 tiver conta de teste.
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
