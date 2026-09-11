/**
 * A fila offline do PDV ligada na tela e na rede (E6, 10/09/2026): o estado
 * React, a persistência em IndexedDB e o laço de sincronização. As decisões
 * de transição estão em `offlineQueue.ts` (puro, testado); aqui só se
 * orquestra.
 *
 * ## Quando sincronizar
 *
 * Duas portas, e de propósito nenhuma terceira:
 *
 *   * **O evento `online` do navegador**, mais uma tentativa na abertura do
 *     PDV se já houver pendência. É barato e cobre o caso comum — o Wi-Fi do
 *     balcão voltou.
 *   * **O botão "Sincronizar agora"**, que é a porta que sempre funciona.
 *     Existe porque `navigator.onLine`/`online` mente: ele responde "estou
 *     ligado a uma rede", não "a internet funciona". Roteador ligado sem link,
 *     portal cativo, DNS caído — nos três o navegador se diz online e a RPC
 *     falha. O botão é a saída do operador quando o automático não percebeu.
 *
 * Não há varredura periódica com recuo exponencial, ao contrário da fila do
 * lado do servidor (A7). A diferença é quem está olhando: A7 roda sozinha, de
 * madrugada, sem ninguém na frente da tela; aqui há um operador no caixa o
 * tempo todo, com o número de pendentes em cima do carrinho e um botão do
 * lado. Tentar sozinho a cada N segundos gastaria bateria e complexidade para
 * poupar um clique de alguém que já está olhando. Decisão registrada em
 * AGENTS.md.
 *
 * ## Por que o laço para na primeira falha de rede
 *
 * Se a rede caiu de novo na venda nº 2, insistir na nº 3 só produziria outra
 * falha — e, se por acaso passasse, gravaria a nº 3 antes da nº 2, invertendo
 * a ordem de `sales.code` e a ordem em que o estoque é disputado. Recusa de
 * **negócio** é diferente: ela não indica nada sobre a rede, então o laço
 * segue para a próxima venda e deixa a recusada visível como `falhou`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPosSale } from "../../lib/repositories/posRepository";
import { isNetworkFailure } from "../../lib/repositories/postgrestFailure";
import type { CreateSaleInput } from "../../lib/repositories/salesRepository";
import type { Product } from "../products/products";
import { emitFiscalDocumentForSale } from "./fiscalDocument";
import {
  createPendingSale,
  discardFailed,
  enqueue,
  failedCount,
  markBusinessFailure,
  markNetworkRetry,
  markSynced,
  markSyncing,
  pendingCount,
  recoverInterrupted,
  syncOrder,
  type PendingSale,
} from "./offlineQueue";
import {
  deletePendingSale,
  isOfflineStorageAvailable,
  readQueue,
  writePendingSale,
  writeQueue,
} from "./offlineStore";
import { GENERIC_SALE_ERROR, posSaleErrorMessage } from "./saleErrors";

export type OfflineSales = {
  queue: PendingSale[];
  pending: number;
  failed: number;
  syncing: boolean;
  /** `navigator.onLine` — sinal auxiliar, nunca a base de uma decisão. Ver o cabeçalho. */
  online: boolean;
  /** `false` = IndexedDB indisponível; nenhuma venda pode ser guardada e a tela precisa dizer isso. */
  storageAvailable: boolean;
  /** Resultado da última sincronização, para mostrar na tela. */
  syncNotice: string | null;
  clearSyncNotice: () => void;
  /** Guarda a venda. Devolve a entrada criada, ou `null` se não deu para persistir. */
  enqueueSale: (payload: CreateSaleInput, totalAmount: number) => Promise<PendingSale | null>;
  sync: () => Promise<void>;
  discard: (id: string) => Promise<void>;
};

export function useOfflineSales(products: Product[]): OfflineSales {
  const [queue, setQueue] = useState<PendingSale[]>([]);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  /** A fila guardada já foi lida do IndexedDB? Antes disso, `queue` vazia não significa "não há pendência". */
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));

  /**
   * Espelho da fila para o laço de sincronização. O laço é `async` e atravessa
   * vários `await`; ler `queue` do fecho daria a fila de quando o laço
   * começou, e a venda marcada na volta sobrescreveria a marcação da anterior.
   */
  const queueRef = useRef<PendingSale[]>([]);
  const syncingRef = useRef(false);
  /** O catálogo de agora, pelo mesmo motivo — o laço traduz erro de estoque com ele. */
  const productsRef = useRef(products);
  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  const apply = useCallback((next: PendingSale[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  /** Aplica a transição na memória e grava a entrada resultante (ou apaga, se ela saiu da fila). */
  const applyAndPersist = useCallback(
    async (next: PendingSale[], id: string) => {
      apply(next);
      const entry = next.find((item) => item.id === id);
      if (entry) await writePendingSale(entry);
      else await deletePendingSale(id);
    },
    [apply],
  );

  // Abertura do PDV: o que estava guardado volta, e o que ficou preso em
  // "sincronizando" vira "falhou" — ver `recoverInterrupted`.
  useEffect(() => {
    let cancelado = false;
    void (async () => {
      const disponivel = await isOfflineStorageAvailable();
      if (cancelado) return;
      setStorageAvailable(disponivel);
      if (!disponivel) {
        setLoaded(true);
        return;
      }
      const guardada = await readQueue();
      if (cancelado) return;
      const interrompidas = guardada.some((item) => item.status === "sincronizando");
      const recuperada = recoverInterrupted(guardada);
      /*
       * Mesclar, e **nunca** substituir. A leitura do IndexedDB é assíncrona,
       * e uma venda offline pode ser confirmada antes de ela terminar — um
       * `apply(recuperada)` seco jogaria fora a venda que `enqueueSale`
       * acabou de pôr em `queueRef`. Ela continuaria gravada no disco (e
       * voltaria na próxima abertura), mas nesta sessão sumiria da tela e não
       * seria sincronizada: o operador ouviu "venda guardada" e não veria
       * pendência nenhuma. `enqueue` casa por id e reordena, então o que já
       * está na memória prevalece sobre a cópia lida do disco.
       */
      let fila = recuperada;
      for (const jaNaMemoria of queueRef.current) fila = enqueue(fila, jaNaMemoria);
      apply(fila);
      if (interrompidas) await writeQueue(recuperada);
      if (!cancelado) setLoaded(true);
    })();
    return () => {
      cancelado = true;
    };
  }, [apply]);

  const enqueueSale = useCallback(
    async (payload: CreateSaleInput, totalAmount: number): Promise<PendingSale | null> => {
      const entry = createPendingSale({
        id: crypto.randomUUID(),
        queuedAt: Date.now(),
        payload,
        totalAmount,
      });
      // Grava ANTES de anunciar. Se o IndexedDB recusar, quem chamou precisa
      // saber que a venda **não** está guardada — ver `offlineStore.ts`.
      const gravou = await writePendingSale(entry);
      if (!gravou) {
        setStorageAvailable(false);
        return null;
      }
      apply(enqueue(queueRef.current, entry));
      return entry;
    },
    [apply],
  );

  const sync = useCallback(async () => {
    if (syncingRef.current) return;
    const aTentar = syncOrder(queueRef.current);
    if (aTentar.length === 0) return;

    syncingRef.current = true;
    setSyncing(true);
    setSyncNotice(null);

    let sincronizadas = 0;
    let recusadas = 0;
    let redeCaiu = false;
    const avisosFiscais: string[] = [];

    try {
      for (const item of aTentar) {
        // Persistido antes da chamada de propósito: é a pista de "a
        // requisição saiu daqui" se a aba morrer agora. Ver `offlineQueue.ts`.
        await applyAndPersist(markSyncing(queueRef.current, item.id, Date.now()), item.id);
        try {
          const sale = await createPosSale(item.payload);
          await applyAndPersist(markSynced(queueRef.current, item.id), item.id);
          sincronizadas += 1;
          // A NFC-e só agora: antes da venda existir no banco não há o que
          // emitir. Mesma regra assíncrona da venda online — nota que não sai
          // não desfaz venda (ver `fiscalDocument.ts`).
          const fiscal = await emitFiscalDocumentForSale(sale.id, item.payload.branchId);
          if (!fiscal.ok) {
            avisosFiscais.push(`Venda ${sale.code} entrou, mas a NFC-e não saiu: ${fiscal.errors.join(" ")}`);
          }
        } catch (err) {
          if (isNetworkFailure(err)) {
            await applyAndPersist(markNetworkRetry(queueRef.current, item.id), item.id);
            redeCaiu = true;
            break;
          }
          const motivo = posSaleErrorMessage(
            err,
            (productId) => productsRef.current.find((product) => product.id === productId)?.description ?? null,
          );
          await applyAndPersist(markBusinessFailure(queueRef.current, item.id, motivo), item.id);
          recusadas += 1;
        }
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }

    const partes: string[] = [];
    if (sincronizadas > 0) {
      partes.push(sincronizadas === 1 ? "1 venda sincronizada." : `${sincronizadas} vendas sincronizadas.`);
    }
    if (recusadas > 0) {
      partes.push(
        recusadas === 1
          ? "1 venda foi recusada e precisa ser resolvida na mão."
          : `${recusadas} vendas foram recusadas e precisam ser resolvidas na mão.`,
      );
    }
    if (redeCaiu) partes.push("A rede caiu de novo — o restante continua na fila.");
    if (partes.length === 0) partes.push(GENERIC_SALE_ERROR);
    setSyncNotice([...partes, ...avisosFiscais].join(" "));
  }, [applyAndPersist]);

  // `online`/`offline` do navegador: bons para saber QUANDO tentar de novo,
  // ruins para saber SE há internet. Por isso mexem só no indicador da tela e
  // disparam uma tentativa — nenhuma venda é aceita ou recusada com base neles.
  useEffect(() => {
    function handleOnline() {
      setOnline(true);
      void sync();
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [sync]);

  /*
   * Uma tentativa, uma só, quando a fila guardada termina de ser lida: é o
   * caso de fechar o PDV com pendência e voltar no dia seguinte, quando
   * nenhum evento `online` vai acontecer porque a rede nunca esteve
   * "desligada" do ponto de vista do navegador.
   *
   * O gatilho é `loaded`, e não o tamanho da fila, de propósito. Amarrar em
   * `queue.length > 0` faria a primeira venda offline do dia disparar uma
   * sincronização no mesmo instante em que foi guardada — uma tentativa
   * garantidamente inútil, e um "Enviando…" piscando na tela no momento em
   * que o operador precisa de silêncio para atender o próximo cliente. Daqui
   * em diante quem tenta é o evento `online` ou o botão.
   */
  const tentouNaAbertura = useRef(false);
  useEffect(() => {
    if (!loaded || tentouNaAbertura.current) return;
    tentouNaAbertura.current = true;
    void sync();
  }, [loaded, sync]);

  const discard = useCallback(
    async (id: string) => {
      const next = discardFailed(queueRef.current, id);
      // `discardFailed` recusa dispensar o que não está em `falhou`. Só apaga
      // do armazenamento o que ela de fato tirou da lista — apagar uma venda
      // ainda pendente aqui a deixaria viva só na memória desta aba.
      if (next.length === queueRef.current.length) return;
      apply(next);
      await deletePendingSale(id);
    },
    [apply],
  );

  return {
    queue,
    pending: pendingCount(queue),
    failed: failedCount(queue),
    syncing,
    online,
    storageAvailable,
    syncNotice,
    clearSyncNotice: () => setSyncNotice(null),
    enqueueSale,
    sync,
    discard,
  };
}
