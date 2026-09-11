/**
 * A fila de vendas pendentes do PDV offline — **lógica pura**, sem
 * IndexedDB, sem `navigator`, sem React (E6, 10/09/2026). Mesma divisão de
 * E1 (`receiptEscpos.ts` puro / `printerPort.ts` na borda) e E4
 * (`scanDetection.ts` puro / `PosPage.tsx` na borda): o que decide o destino
 * do dinheiro mora aqui e é testável; o que fala com o navegador mora em
 * `offlineStore.ts` e não decide nada.
 *
 * ## O que esta fila é, e o que ela não é
 *
 * Ela **não** grava venda nenhuma. Toda venda deste sistema continua nascendo
 * dentro da RPC `create_pos_sale`, que é a única coisa capaz de garantir, de
 * forma atômica, as duas verdades que a tela não consegue conferir sozinha:
 * que existe sessão de caixa aberta na filial, e que o estoque não fica
 * negativo (o `select ... for update` de `create_sale`). O que a fila faz é
 * guardar o **pedido** — o mesmo payload que `createPosSale` receberia — para
 * mandar quando a rede voltar.
 *
 * Isso tem uma consequência que não dá para esconder e está documentada em
 * AGENTS.md: entre o clique em "Confirmar" e a sincronização, o dinheiro já
 * saiu da gaveta e a mercadoria já saiu da loja, mas o sistema ainda não sabe
 * disso. Se a RPC recusar na hora de sincronizar (a sessão tinha sido fechada
 * mesmo; o estoque acabou mesmo), a venda **não pode sumir em silêncio** — ela
 * vira `"falhou"` e fica visível na tela até alguém resolver na mão. É por
 * isso que não existe descarte automático em lugar nenhum deste arquivo.
 *
 * ## Os três estados, e por que "sincronizando" é persistido
 *
 *   * `pendente` — esperando rede. É o estado normal.
 *   * `sincronizando` — a RPC foi disparada e ainda não respondeu.
 *   * `falhou` — precisa de gente. Nunca sai daqui sozinho.
 *
 * `sincronizando` é gravado no armazenamento **antes** da chamada, e não só
 * mantido em memória, de propósito. Se a aba morrer no meio (queda de
 * energia no caixa é o caso realista), na volta encontra-se uma venda parada
 * nesse estado — e isso é a única pista de que a requisição chegou a sair
 * daqui. `recoverInterrupted` transforma essas em `falhou`, não em
 * `pendente`: reenviar seria arriscar gravar a venda duas vezes, e uma venda
 * duplicada baixa estoque duas vezes e lança dinheiro que não entrou.
 */
import type { CreateSaleInput } from "../../lib/repositories/salesRepository";

export type PendingSaleStatus = "pendente" | "sincronizando" | "falhou";

export type PendingSale = {
  /** `crypto.randomUUID()` local. É a chave no armazenamento e o que o cupom provisório imprime (ver `shortPendingCode`). */
  id: string;
  /** `Date.now()` do clique em "Confirmar Venda". Define a ordem de sincronização. */
  queuedAt: number;
  status: PendingSaleStatus;
  /** Quantas vezes a RPC já foi tentada — só para mostrar na tela; nada decide com base nisto. */
  attempts: number;
  /** Idêntico ao que `createPosSale` receberia se houvesse rede. Nada é recalculado na hora de sincronizar. */
  payload: CreateSaleInput;
  /** Total já calculado, só para listar a fila sem refazer a conta do carrinho. */
  totalAmount: number;
  /** Por que precisa de gente — preenchido junto com `status: "falhou"`. */
  failureReason?: string;
  lastAttemptAt?: number;
};

/**
 * O texto que vai no lugar de `sales.code` no cupom de uma venda que ainda
 * não foi gravada. Não existe número de venda nesse momento — inventar um que
 * pareça `sales.code` seria imprimir um número que não vai existir no
 * sistema. `PEND-` deixa claro o que é, e os oito dígitos são os mesmos que a
 * tela mostra na lista de pendentes, então dá para casar papel e fila.
 */
export function shortPendingCode(id: string): string {
  return `PEND-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function createPendingSale(input: {
  id: string;
  queuedAt: number;
  payload: CreateSaleInput;
  totalAmount: number;
}): PendingSale {
  return {
    id: input.id,
    queuedAt: input.queuedAt,
    status: "pendente",
    attempts: 0,
    payload: input.payload,
    totalAmount: input.totalAmount,
  };
}

function sortByQueuedAt(queue: PendingSale[]): PendingSale[] {
  return [...queue].sort((a, b) => (a.queuedAt === b.queuedAt ? a.id.localeCompare(b.id) : a.queuedAt - b.queuedAt));
}

/** Acrescenta mantendo a ordem de chegada — ver `syncOrder`. */
export function enqueue(queue: PendingSale[], entry: PendingSale): PendingSale[] {
  return sortByQueuedAt([...queue.filter((item) => item.id !== entry.id), entry]);
}

/**
 * As vendas a tentar, **na ordem em que foram feitas**.
 *
 * A ordem não é estética. Duas vendas offline do mesmo produto com uma
 * unidade em estoque: só uma vai passar, e a que passa tem que ser a primeira
 * que o cliente pagou — não a que o armazenamento devolveu primeiro. A
 * numeração de `sales.code`, que é sequencial por filial, também nasce na
 * ordem de gravação.
 *
 * `falhou` fica de fora: já é de gente, não de retentativa.
 */
export function syncOrder(queue: PendingSale[]): PendingSale[] {
  return sortByQueuedAt(queue.filter((item) => item.status !== "falhou"));
}

export function pendingCount(queue: PendingSale[]): number {
  return queue.filter((item) => item.status !== "falhou").length;
}

export function failedCount(queue: PendingSale[]): number {
  return queue.filter((item) => item.status === "falhou").length;
}

function patch(queue: PendingSale[], id: string, change: (item: PendingSale) => PendingSale): PendingSale[] {
  return queue.map((item) => (item.id === id ? change(item) : item));
}

/** Antes de disparar a RPC. Persistido — ver `recoverInterrupted`. */
export function markSyncing(queue: PendingSale[], id: string, now: number): PendingSale[] {
  return patch(queue, id, (item) => ({
    ...item,
    status: "sincronizando",
    attempts: item.attempts + 1,
    lastAttemptAt: now,
    failureReason: undefined,
  }));
}

/** A RPC gravou a venda: a pendência deixa de existir. É o único caminho por onde algo sai da fila sozinho. */
export function markSynced(queue: PendingSale[], id: string): PendingSale[] {
  return queue.filter((item) => item.id !== id);
}

/**
 * A rede falhou de novo — volta para `pendente` e espera a próxima tentativa.
 * Sem limite de tentativas de propósito: desistir de uma venda por ter
 * tentado muitas vezes seria jogar fora dinheiro que já entrou no caixa.
 */
export function markNetworkRetry(queue: PendingSale[], id: string): PendingSale[] {
  return patch(queue, id, (item) => ({ ...item, status: "pendente" }));
}

/**
 * A RPC **respondeu** e recusou: sessão de caixa fechada, estoque acabado,
 * permissão perdida. Fica `falhou` até alguém olhar. Não há retentativa
 * automática: tentar de novo daria a mesma recusa, e esconderia atrás de uma
 * roda girando o fato de que existe uma venda paga sem registro no sistema.
 */
export function markBusinessFailure(queue: PendingSale[], id: string, reason: string): PendingSale[] {
  return patch(queue, id, (item) => ({ ...item, status: "falhou", failureReason: reason }));
}

export const INTERRUPTED_REASON =
  "A sincronização foi interrompida no meio (aba fechada ou queda de energia). Esta venda pode ter sido gravada — confira em Vendas antes de refazer.";

/**
 * Chamada ao abrir o PDV, sobre o que veio do armazenamento.
 *
 * Uma venda encontrada em `sincronizando` significa que a requisição saiu
 * daqui e ninguém viu a resposta. Ela vira `falhou`, não `pendente` — ver o
 * cabeçalho deste arquivo.
 */
export function recoverInterrupted(queue: PendingSale[]): PendingSale[] {
  return queue.map((item) =>
    item.status === "sincronizando"
      ? { ...item, status: "falhou" as const, failureReason: INTERRUPTED_REASON }
      : item,
  );
}

/**
 * Tira da fila uma venda que o operador já resolveu na mão (refez no sistema,
 * ou conferiu que ela já estava lá). Só vale para `falhou`: dispensar uma
 * pendente seria apagar uma venda que ainda tem chance de entrar sozinha.
 */
export function discardFailed(queue: PendingSale[], id: string): PendingSale[] {
  return queue.filter((item) => !(item.id === id && item.status === "falhou"));
}
