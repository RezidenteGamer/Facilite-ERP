/**
 * "Isto foi a rede caindo ou o banco recusando?" — a pergunta que o PDV
 * offline (E6, 10/09/2026) precisa responder para decidir entre **guardar a
 * venda na fila** e **mostrar um erro de verdade para o operador**.
 *
 * ## Por que não dá para perguntar isso à mensagem do erro
 *
 * Pesquisa desta tarefa, feita no código do `@supabase/postgrest-js` 2.112.2
 * que está em `node_modules` e confirmada rodando uma chamada de verdade
 * contra um host que não resolve:
 *
 * ```
 * status: 0 ""
 * error keys: [ 'message', 'details', 'hint', 'code' ]
 * error.message: "TypeError: fetch failed"
 * error.code: ""
 * instanceof Error: false      // é objeto simples, não Error
 * ```
 *
 * Duas armadilhas aí dentro:
 *
 *   * **A mensagem é do navegador, não da biblioteca.** Em Node ela é
 *     `"TypeError: fetch failed"`; no Chrome, `"TypeError: Failed to fetch"`;
 *     no Firefox, `"NetworkError when attempting to fetch resource."`; no
 *     Safari, `"Load failed"`. Casar isso por expressão regular é escrever um
 *     teste que passa na máquina de quem escreveu e falha no balcão do
 *     cliente — e a consequência de errar aqui é dinheiro: ou uma venda de
 *     verdade some, ou uma recusa de negócio vira "venda guardada" mentirosa.
 *   * **O erro não é `Error`.** `err instanceof Error` é `false`, então o
 *     reflexo de checar `TypeError` também não funciona.
 *
 * ## O que a biblioteca *garante*, e é nisto que este módulo se apoia
 *
 * `PostgrestBuilder.then()` só produz `status: 0` num lugar: o `catch` em
 * volta do `fetch` — quando a requisição nem chegou a virar resposta HTTP.
 * Toda resposta que o PostgREST devolveu, inclusive recusa de negócio, sai
 * com o status HTTP de verdade (400 para `RAISE EXCEPTION` de plpgsql, com
 * `code` no SQLSTATE — `P0001` no caso das mensagens em português de
 * `create_pos_sale`). Então `status` responde a pergunta sem depender de
 * texto nenhum.
 *
 * Repare também que a biblioteca **não repete POST sozinha**:
 * `RETRYABLE_METHODS` é `["GET", "HEAD", "OPTIONS"]`. Uma RPC que falhou por
 * rede falhou uma vez só — quem decide tentar de novo é a fila do PDV, não a
 * biblioteca por baixo.
 */

export type PostgrestFailureKind = "rede" | "negocio";

/**
 * Status HTTP que, mesmo tendo chegado do servidor, **não** são recusa de
 * negócio: são infraestrutura passageira entre o PDV e o Postgres (gateway,
 * proxy, limite de taxa, banco ocupado). Tratá-los como rede é o que evita a
 * venda sumir por causa de um 502 do proxy no meio do horário de pico.
 *
 * 401/403 ficam **de fora** de propósito: sessão expirada e falta de
 * permissão são recusas que o operador precisa ver agora, e enfileirar não
 * conserta nenhuma das duas — a tentativa seguinte seria recusada igual.
 */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

/** `status` de uma resposta do postgrest-js → rede ou negócio. Ver o cabeçalho. */
export function classifyPostgrestFailure(status: number): PostgrestFailureKind {
  if (status === 0) return "rede";
  return TRANSIENT_STATUS.has(status) ? "rede" : "negocio";
}

/**
 * O erro que os repositórios passam a lançar no lugar do objeto cru do
 * postgrest-js.
 *
 * `message` continua sendo **exatamente** a mensagem que veio do banco: todo
 * tratamento de erro que já existia (`extractErrorMessage` do PDV e de
 * `lib/errorMessage.ts`, que casam a mensagem em português contra uma lista)
 * segue funcionando sem saber que esta classe existe. O que ela acrescenta é
 * `kind` — a única informação que estava sendo jogada fora antes, porque
 * `throw error` descarta o `status` da resposta.
 */
export class SupabaseRequestError extends Error {
  readonly kind: PostgrestFailureKind;
  readonly status: number;
  /** SQLSTATE quando veio do Postgres (`P0001`, `23505`…); `""` em falha de rede. */
  readonly code: string;

  constructor(message: string, kind: PostgrestFailureKind, status: number, code: string) {
    super(message);
    this.name = "SupabaseRequestError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

type PostgrestLikeError = { message?: unknown; code?: unknown } | null;

/**
 * Lança o erro de uma resposta do postgrest-js preservando a classificação.
 *
 * Recebe `status` separado porque é isso que se perde no `if (error) throw
 * error` que os repositórios faziam — o objeto de erro sozinho não sabe se
 * houve resposta HTTP.
 */
export function throwSupabaseError(error: PostgrestLikeError, status: number): never {
  const message =
    error && typeof error.message === "string" && error.message
      ? error.message
      : "Não foi possível falar com o servidor.";
  const code = error && typeof error.code === "string" ? error.code : "";
  throw new SupabaseRequestError(message, classifyPostgrestFailure(status), status, code);
}

/**
 * O erro lançado é falha de rede?
 *
 * Só devolve `true` para um `SupabaseRequestError` de verdade — um erro de
 * outra origem (bug de JavaScript no meio do caminho, por exemplo) é tratado
 * como erro comum e **não** vira venda na fila. Enfileirar o que não se sabe
 * o que é seria prometer ao operador que a venda está guardada sem base.
 */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof SupabaseRequestError && err.kind === "rede";
}
