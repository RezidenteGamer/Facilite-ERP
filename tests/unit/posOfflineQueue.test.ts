import { describe, expect, it } from "vitest";

import {
  classifyPostgrestFailure,
  isNetworkFailure,
  SupabaseRequestError,
  throwSupabaseError,
} from "../../src/lib/repositories/postgrestFailure";
import {
  createPendingSale,
  discardFailed,
  enqueue,
  failedCount,
  INTERRUPTED_REASON,
  markBusinessFailure,
  markNetworkRetry,
  markSynced,
  markSyncing,
  pendingCount,
  recoverInterrupted,
  shortPendingCode,
  syncOrder,
  type PendingSale,
} from "../../src/features/pos/offlineQueue";
import type { CreateSaleInput } from "../../src/lib/repositories/salesRepository";

/**
 * PDV offline — a fila de vendas pendentes e a distinção rede × negócio
 * (E6, 10/09/2026).
 *
 * ## O que esta bateria prova, e o que ela não tem como provar
 *
 * Prova: as transições da fila (quem entra, quem sai, em que ordem se tenta,
 * o que nunca sai sozinho) e a classificação de falha que decide entre
 * guardar a venda e mostrar erro ao operador.
 *
 * **Não** prova, e está dito no relatório da tarefa, mesmo padrão de E1
 * (impressora) e E4 (leitor):
 *
 *   * **IndexedDB de verdade.** O ambiente de teste é `node` (ver
 *     `vitest.config.ts`), onde `indexedDB` não existe. Por isso o núcleo
 *     desta tarefa é puro e `offlineStore.ts` — a borda — não decide nada: o
 *     que dá para testar está testado, e o que não dá está isolado num
 *     arquivo que só guarda e devolve. Cota estourada, janela anônima e banco
 *     bloqueado por política continuam sendo comportamento observável só em
 *     navegador de verdade.
 *   * **Rede caindo de verdade.** Nenhum mock reproduz uma conexão que morre
 *     no meio de um POST — o caso em que o servidor gravou a venda e a
 *     resposta se perdeu no caminho. O que está testado aqui é a resposta do
 *     `@supabase/postgrest-js` a essa situação, e essa resposta foi
 *     **observada**, não suposta: os vetores de `throwSupabaseError` abaixo
 *     são cópia literal do que uma chamada real a um host que não resolve
 *     devolveu nesta sessão (`status: 0`, `code: ""`, objeto simples que não
 *     é `Error`).
 */

const PAYLOAD: CreateSaleInput = {
  branchId: "11111111-1111-1111-1111-111111111111",
  contactId: null,
  sellerId: "22222222-2222-2222-2222-222222222222",
  issueDate: "2026-09-10",
  discountAmount: 0,
  items: [{ productId: "33333333-3333-3333-3333-333333333333", quantity: 2, unitPrice: 10 }],
  payments: [{ method: "dinheiro", amount: 20, installments: 1 }],
};

function pendente(id: string, queuedAt: number): PendingSale {
  return createPendingSale({ id, queuedAt, payload: PAYLOAD, totalAmount: 20 });
}

describe("classificação de falha: rede × recusa do banco", () => {
  it("status 0 é rede — é o único status que o postgrest-js produz quando o fetch nem virou resposta", () => {
    expect(classifyPostgrestFailure(0)).toBe("rede");
  });

  it("400 é negócio — é como `RAISE EXCEPTION` de `create_pos_sale` chega", () => {
    expect(classifyPostgrestFailure(400)).toBe("negocio");
  });

  it.each([408, 425, 429, 500, 502, 503, 504, 520, 524])(
    "%i é rede: veio do servidor, mas é infraestrutura passageira, não recusa",
    (status) => {
      expect(classifyPostgrestFailure(status)).toBe("rede");
    },
  );

  it.each([401, 403, 404, 409, 422])(
    "%i é negócio: enfileirar não conserta, a tentativa seguinte seria recusada igual",
    (status) => {
      expect(classifyPostgrestFailure(status)).toBe("negocio");
    },
  );
});

describe("throwSupabaseError", () => {
  /**
   * Vetor observado nesta sessão chamando `client.rpc("create_pos_sale", …)`
   * contra um host inexistente. Repare que não é `Error`, que `code` é string
   * vazia (e não `undefined`), e que a mensagem embute o nome do erro do
   * ambiente — `"fetch failed"` em Node, `"Failed to fetch"` no Chrome,
   * `"NetworkError…"` no Firefox. É por isso que a classificação olha o
   * `status` e nunca o texto.
   */
  const FALHA_DE_REDE = { message: "TypeError: fetch failed", details: "TypeError: fetch failed", hint: "", code: "" };

  /** `create_pos_sale` recusando por falta de sessão de caixa aberta: SQLSTATE P0001, HTTP 400. */
  const RECUSA_DE_NEGOCIO = {
    message: "Abra uma sessão de caixa antes de vender.",
    details: null,
    hint: null,
    code: "P0001",
  };

  it("falha de rede vira SupabaseRequestError com kind 'rede'", () => {
    expect(() => throwSupabaseError(FALHA_DE_REDE, 0)).toThrow(SupabaseRequestError);
    try {
      throwSupabaseError(FALHA_DE_REDE, 0);
    } catch (err) {
      expect(isNetworkFailure(err)).toBe(true);
      expect((err as SupabaseRequestError).kind).toBe("rede");
    }
  });

  it("recusa de negócio NÃO é falha de rede, mesmo sendo o mesmo formato de objeto", () => {
    try {
      throwSupabaseError(RECUSA_DE_NEGOCIO, 400);
      expect.unreachable();
    } catch (err) {
      expect(isNetworkFailure(err)).toBe(false);
      expect((err as SupabaseRequestError).code).toBe("P0001");
    }
  });

  it("preserva a mensagem do banco palavra por palavra — `posSaleErrorMessage` casa por texto", () => {
    try {
      throwSupabaseError(RECUSA_DE_NEGOCIO, 400);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toBe("Abra uma sessão de caixa antes de vender.");
    }
  });

  it("erro de qualquer outra origem não é tratado como rede — venda só entra na fila com base conhecida", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(false);
    expect(isNetworkFailure({ message: "Failed to fetch", code: "" })).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
  });
});

describe("fila offline: entrar e sair", () => {
  it("uma venda nasce pendente, com zero tentativas", () => {
    const item = pendente("a", 100);
    expect(item.status).toBe("pendente");
    expect(item.attempts).toBe(0);
    expect(item.payload).toEqual(PAYLOAD);
  });

  it("enqueue acrescenta sem perder o que já estava lá", () => {
    const fila = enqueue(enqueue([], pendente("a", 100)), pendente("b", 200));
    expect(fila.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("enqueue casa por id: a versão em memória prevalece sobre a lida do disco", () => {
    /*
     * É a propriedade em que a abertura do PDV se apoia (`useOfflineSales`):
     * a fila guardada é **mesclada** com o que já estiver em `queueRef`, e
     * não substitui. Sem isso, uma venda confirmada enquanto o IndexedDB
     * ainda estava sendo lido sumiria da tela.
     */
    const doDisco = { ...pendente("a", 100), attempts: 9 };
    const daMemoria = pendente("a", 100);
    const fila = enqueue([doDisco], daMemoria);

    expect(fila).toHaveLength(1);
    expect(fila[0].attempts).toBe(0);
  });

  it("sincronizar remove da fila — é o único jeito de algo sair sozinho", () => {
    const fila = enqueue(enqueue([], pendente("a", 100)), pendente("b", 200));
    expect(markSynced(fila, "a").map((item) => item.id)).toEqual(["b"]);
  });

  it("markSyncing conta a tentativa e limpa o motivo anterior", () => {
    const fila = markBusinessFailure(enqueue([], pendente("a", 100)), "a", "Estoque insuficiente.");
    const tentando = markSyncing(fila, "a", 999);
    expect(tentando[0].status).toBe("sincronizando");
    expect(tentando[0].attempts).toBe(1);
    expect(tentando[0].lastAttemptAt).toBe(999);
    expect(tentando[0].failureReason).toBeUndefined();
  });
});

describe("fila offline: a ordem de tentar é a ordem em que o cliente pagou", () => {
  it("ordena por queuedAt, não pela ordem em que o armazenamento devolveu", () => {
    const fora_de_ordem = [pendente("terceira", 300), pendente("primeira", 100), pendente("segunda", 200)];
    expect(syncOrder(fora_de_ordem).map((item) => item.id)).toEqual(["primeira", "segunda", "terceira"]);
  });

  it("desempata por id quando duas vendas têm o mesmo carimbo — ordem estável, nunca aleatória", () => {
    const empate = [pendente("b", 100), pendente("a", 100)];
    expect(syncOrder(empate).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("venda que falhou fica fora da ordem de tentativa — ela é de gente, não de retentativa", () => {
    const fila = markBusinessFailure(
      enqueue(enqueue([], pendente("a", 100)), pendente("b", 200)),
      "a",
      "Estoque insuficiente.",
    );
    expect(syncOrder(fila).map((item) => item.id)).toEqual(["b"]);
    expect(pendingCount(fila)).toBe(1);
    expect(failedCount(fila)).toBe(1);
  });

  it("uma venda sendo enviada continua contando como pendente — ela ainda não está no banco", () => {
    const fila = markSyncing(enqueue([], pendente("a", 100)), "a", 1);
    expect(pendingCount(fila)).toBe(1);
    expect(failedCount(fila)).toBe(0);
  });
});

describe("fila offline: o que acontece quando a tentativa não dá certo", () => {
  it("rede caindo de novo devolve a venda para 'pendente' — sem teto de tentativas", () => {
    let fila = enqueue([], pendente("a", 100));
    for (let i = 0; i < 50; i += 1) {
      fila = markNetworkRetry(markSyncing(fila, "a", i), "a");
    }
    expect(fila[0].status).toBe("pendente");
    expect(fila[0].attempts).toBe(50);
    expect(syncOrder(fila)).toHaveLength(1);
  });

  it("recusa de negócio para em 'falhou' com o motivo, e não volta a ser tentada", () => {
    const fila = markBusinessFailure(
      markSyncing(enqueue([], pendente("a", 100)), "a", 1),
      "a",
      "Abra uma sessão de caixa antes de vender.",
    );
    expect(fila[0].status).toBe("falhou");
    expect(fila[0].failureReason).toBe("Abra uma sessão de caixa antes de vender.");
    expect(syncOrder(fila)).toHaveLength(0);
  });

  it("nada é descartado em silêncio: uma venda recusada continua na lista até alguém dispensar", () => {
    const fila = markBusinessFailure(enqueue([], pendente("a", 100)), "a", "Estoque insuficiente.");
    expect(fila).toHaveLength(1);
    expect(markSynced(fila, "outro-id")).toHaveLength(1);
  });
});

describe("fila offline: sincronização interrompida no meio", () => {
  it("uma venda presa em 'sincronizando' vira 'falhou', não 'pendente'", () => {
    /*
     * O cenário: a aba morreu (queda de energia no caixa) entre o `markSyncing`
     * persistido e a resposta da RPC. A requisição SAIU daqui, então reenviar
     * arriscaria gravar a venda duas vezes — estoque baixado em dobro e
     * dinheiro lançado que não entrou. Ver `offlineQueue.ts`.
     */
    const guardada = markSyncing(enqueue([], pendente("a", 100)), "a", 1);
    const recuperada = recoverInterrupted(guardada);
    expect(recuperada[0].status).toBe("falhou");
    expect(recuperada[0].failureReason).toBe(INTERRUPTED_REASON);
    expect(syncOrder(recuperada)).toHaveLength(0);
  });

  it("venda que estava apenas pendente não é tocada — essa a rede nunca levou", () => {
    const recuperada = recoverInterrupted(enqueue([], pendente("a", 100)));
    expect(recuperada[0].status).toBe("pendente");
    expect(recuperada[0].failureReason).toBeUndefined();
  });
});

describe("fila offline: dispensar na mão", () => {
  it("dispensa uma venda recusada que o operador já resolveu", () => {
    const fila = markBusinessFailure(enqueue([], pendente("a", 100)), "a", "Estoque insuficiente.");
    expect(discardFailed(fila, "a")).toHaveLength(0);
  });

  it("NÃO dispensa uma venda ainda pendente — ela ainda tem chance de entrar sozinha", () => {
    const fila = enqueue([], pendente("a", 100));
    expect(discardFailed(fila, "a")).toHaveLength(1);
  });

  it("NÃO dispensa uma venda em pleno envio", () => {
    const fila = markSyncing(enqueue([], pendente("a", 100)), "a", 1);
    expect(discardFailed(fila, "a")).toHaveLength(1);
  });
});

describe("código provisório do cupom", () => {
  it("é derivado do id da fila, então papel e tela mostram o mesmo", () => {
    expect(shortPendingCode("0f8a1b2c-3d4e-5f60-7182-93a4b5c6d7e8")).toBe("PEND-0F8A1B2C");
  });

  it("não se parece com um `sales.code` — o número da venda ainda não existe", () => {
    expect(shortPendingCode(crypto.randomUUID())).toMatch(/^PEND-[0-9A-F]{8}$/);
  });
});
