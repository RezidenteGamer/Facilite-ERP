/**
 * **O contrato de emissão fiscal — a fonte da verdade.**
 *
 * Até A2 (01/09/2026) este tipo morava em `src/lib/fiscal/types.ts`, dentro do
 * bundle do navegador, com três métodos (`emit`, `cancel`, `query`). Duas
 * coisas mudaram, e as duas têm o mesmo motivo:
 *
 * 1. **Mudou de lugar.** O núcleo fiscal passou a viver em
 *    `supabase/functions/_shared/fiscal/`, para rodar nas duas bordas: a Edge
 *    Function que emite de verdade (Deno — por isso todo import relativo aqui
 *    leva `.ts` explícito) e o front, que o consome pelo alias `@fiscal-core`
 *    **só para prévia na tela, nunca para emitir**. `src/lib/fiscal/provider.ts`
 *    continua existindo, mas só como registry do front (lê a variável de
 *    ambiente) e reexport.
 * 2. **Cresceu para sete métodos.** Os quatro novos — `correctionLetter`,
 *    `invalidateRange`, `getXml`, `getDanfe` — não são invenção desta tarefa:
 *    são o que o relatório de benchmark cobrava e o que as ações hoje
 *    `disabled: true` em `InvoicesPage.tsx` ("Carta de correção") precisavam
 *    para ter destino. Sem eles no contrato, cada tela que precisasse de um
 *    evento acabaria falando com um provedor concreto — exatamente o que esta
 *    interface existe para impedir.
 *
 * ## Rejeição não é exceção
 *
 * Regra herdada da etapa F1 e mantida nos quatro métodos novos: uma nota (ou um
 * evento) recusada pela SEFAZ volta como **resultado**, com `status` e
 * `mensagemSefaz` preenchidos — é resultado de negócio que a tela precisa
 * mostrar, não falha de programa. As implementações só lançam quando o
 * transporte falha (rede fora, token inválido, resposta ilegível) ou quando o
 * provedor **não está configurado** (`FiscalNotConfiguredError`), que são os
 * casos em que não há nada de negócio para exibir.
 */

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

/**
 * O contrato. Sete métodos — os três da etapa F1 mais os quatro de A2.
 *
 * ## Por que `getXml`/`getDanfe` devolvem `FiscalArtifact | null`
 *
 * Desvio deliberado do desenho de partida do plano, que os declarava como
 * `Promise<FiscalArtifact>`. Uma nota em `processando_autorizacao` ainda não
 * tem XML, e uma em `erro_autorizacao` nunca vai ter — os dois são estados
 * **legítimos** do documento, não erro de programa. Devolver `null` deixa a
 * tela dizer "ainda não disponível" sem `try/catch`, na mesma filosofia de
 * "rejeição não é exceção" que rege o resto da interface. Lançar ficaria
 * reservado ao transporte, e aí não haveria como distinguir "sem artefato" de
 * "a rede caiu".
 *
 * Os dois existem porque `emit`/`query` já trazem o artefato **quando o
 * provedor o entrega junto** — o simulado gera na hora, e a Focus devolve o
 * caminho. O que eles resolvem é o caso em que o artefato precisa ser buscado
 * depois (nota emitida numa sessão anterior, ou `path` que expirou), sem que a
 * tela precise saber qual dos dois transportes está ativo.
 */
export type FiscalProvider = {
  /** Identifica a implementação ativa nos logs e na tela de configurações. */
  readonly id: string;

  emit(request: FiscalEmitRequest): Promise<FiscalDocument>;
  query(ref: string): Promise<FiscalDocument>;
  cancel(request: FiscalCancelRequest): Promise<FiscalCancelResult>;

  /** Carta de correção eletrônica (CC-e) — ver `FiscalCorrectionRequest`. */
  correctionLetter(request: FiscalCorrectionRequest): Promise<FiscalEventResult>;
  /** Inutilização de faixa de numeração — ver `FiscalInvalidateRequest`. */
  invalidateRange(request: FiscalInvalidateRequest): Promise<FiscalEventResult>;

  /** XML da nota, ou `null` enquanto não existir artefato para essa `ref`. */
  getXml(ref: string): Promise<FiscalArtifact | null>;
  /** DANFE/DANFCE, ou `null` enquanto não existir artefato para essa `ref`. */
  getDanfe(ref: string): Promise<FiscalArtifact | null>;
};

/**
 * O provedor existe, mas não está configurado para operar.
 *
 * É o que `createFocusProvider()` lança nos sete métodos até a tarefa A12
 * plugar a chamada HTTP de verdade. **Erro, e não um resultado recusado**, de
 * propósito: um `status: "erro_autorizacao"` diria que a SEFAZ recusou a nota,
 * o que seria mentira e mandaria o operador procurar problema no cadastro. Isto
 * aqui é falta de configuração do sistema — mesma categoria de "token
 * inválido", que a regra da interface já manda lançar.
 */
export class FiscalNotConfiguredError extends Error {
  /** Qual provedor não está configurado (`FiscalProvider.id`). */
  readonly providerId: string;
  /** Qual das sete operações foi pedida — entra na mensagem e no log. */
  readonly operation: string;

  constructor(providerId: string, operation: string, detail?: string) {
    super(
      `O provedor fiscal "${providerId}" não está configurado — a operação "${operation}" ` +
        `não pode ser executada.${detail ? ` ${detail}` : ""}`,
    );
    this.name = "FiscalNotConfiguredError";
    this.providerId = providerId;
    this.operation = operation;
  }
}
