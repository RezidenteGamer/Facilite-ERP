/**
 * A borda do PDV offline: IndexedDB (E6, 10/09/2026). Este arquivo **não
 * decide nada** — ele guarda e devolve o que `offlineQueue.ts`,
 * `usePosCatalog.ts` e `usePosSale.ts` mandarem. Toda regra de negócio que
 * envolve a fila mora no núcleo puro, que é o que os testes cobrem.
 *
 * ## Por que IndexedDB e não `localStorage`
 *
 * O catálogo da filial é a lista inteira de produtos — num supermercado
 * pequeno já são milhares de linhas com preço, estoque, NCM, GTIN. Passa
 * folgado do limite prático de `localStorage` (5 MB, e por origem inteira,
 * dividido com todo o resto do sistema), e `localStorage` é síncrono: gravar
 * megabytes nele trava a tela do caixa no meio da venda. IndexedDB é
 * assíncrono, tem cota de ordens de grandeza maior e guarda objeto
 * estruturado sem `JSON.stringify` no caminho.
 *
 * O estado da sessão de caixa caberia em `localStorage` — é um objeto
 * pequeno. Ele fica aqui mesmo assim para não haver **dois** armazenamentos
 * com regras de expiração e limpeza diferentes segurando partes do mesmo
 * estado offline: o dia em que alguém limpar um e esquecer o outro, o PDV
 * acorda com catálogo de ontem e sessão de anteontem.
 *
 * ## Quando o IndexedDB simplesmente não está lá
 *
 * Acontece de verdade: janela privada em alguns navegadores, política de
 * "bloquear dados de sites", perfil corporativo restrito, cota estourada.
 * Toda função daqui devolve `null`/`false` em vez de lançar, e
 * `isOfflineStorageAvailable()` responde se dá para contar com ele.
 *
 * Isso importa muito num lugar só, e é o lugar onde tem dinheiro: se a fila
 * não puder ser gravada, `usePosSale` **não** pode dizer "venda guardada".
 * Uma venda que só existe na memória de uma aba é uma venda que some no
 * primeiro F5. Ver `enqueueOfflineSale` em `useOfflineSales.ts`.
 */
import type { CashSession } from "../cashcontrol/cashControl";
import type { Product } from "../products/products";
import type { PendingSale } from "./offlineQueue";

const DB_NAME = "facilite-pdv";
const DB_VERSION = 1;

const STORE_CATALOG = "catalogo";
const STORE_SESSION = "sessao";
const STORE_QUEUE = "fila";

export type CachedCatalog = {
  branchId: string;
  /** `Date.now()` da carga bem-sucedida que originou este cache — é o que a tela mostra como "catálogo de HH:MM". */
  savedAt: number;
  products: Product[];
};

export type KnownCashSession = {
  branchId: string;
  savedAt: number;
  /** O último estado **confirmado pelo servidor**. `null` significa "confirmamos que não havia sessão aberta". */
  session: CashSession | null;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      // Navegador com armazenamento bloqueado por política lança já no `open`.
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CATALOG)) db.createObjectStore(STORE_CATALOG, { keyPath: "branchId" });
      if (!db.objectStoreNames.contains(STORE_SESSION)) db.createObjectStore(STORE_SESSION, { keyPath: "branchId" });
      if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE, { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      /*
       * Sem isto, a conexão aberta aqui **bloqueia para sempre** um upgrade
       * de `DB_VERSION` pedido por outra aba: a outra aba cai no `onblocked`
       * abaixo, desiste, e o PDV dela fica sem retaguarda offline sem que
       * ninguém entenda por quê. Fechar quando o navegador avisa é o par
       * padrão de `onupgradeneeded`, e só tem efeito no dia em que este
       * esquema mudar — que é justamente o dia em que a falta dele apareceria.
       */
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => resolve(null);
    // Outra aba do PDV segurando uma versão anterior do banco. Não trava a
    // tela esperando: o PDV segue online normalmente, só sem retaguarda.
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

export async function isOfflineStorageAvailable(): Promise<boolean> {
  return (await openDatabase()) !== null;
}

function runRequest<T>(store: IDBObjectStore, request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    store.transaction.onabort = () => resolve(null);
  });
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T | null>,
): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const transaction = db.transaction(name, mode);
    return await run(transaction.objectStore(name));
  } catch {
    // Cota estourada, banco fechado pelo navegador, store ausente por
    // versão antiga: nada disto pode derrubar o PDV.
    return null;
  }
}

/**
 * Grava confirmando de verdade: só resolve `true` quando a transação
 * **commitou**. Escutar o `onsuccess` do `put` não bastaria — um `put` que
 * deu certo dentro de uma transação que depois aborta (cota estourada é o
 * caso comum) não deixou nada gravado.
 */
function commitWrites(store: IDBObjectStore, write: (store: IDBObjectStore) => void): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      write(store);
    } catch {
      resolve(false);
      return;
    }
    store.transaction.oncomplete = () => resolve(true);
    store.transaction.onabort = () => resolve(false);
    store.transaction.onerror = () => resolve(false);
  });
}

/* ------------------------------------------------------------------
   Catálogo local
   ------------------------------------------------------------------ */

export async function saveCachedCatalog(branchId: string, products: Product[]): Promise<void> {
  const entry: CachedCatalog = { branchId, savedAt: Date.now(), products };
  await withStore(STORE_CATALOG, "readwrite", (store) => commitWrites(store, () => void store.put(entry)));
}

export async function readCachedCatalog(branchId: string): Promise<CachedCatalog | null> {
  const entry = await withStore(STORE_CATALOG, "readonly", (store) =>
    runRequest<CachedCatalog>(store, store.get(branchId) as IDBRequest<CachedCatalog>),
  );
  return entry ?? null;
}

/* ------------------------------------------------------------------
   Último estado conhecido da sessão de caixa
   ------------------------------------------------------------------ */

export async function saveKnownCashSession(branchId: string, session: CashSession | null): Promise<void> {
  const entry: KnownCashSession = { branchId, savedAt: Date.now(), session };
  await withStore(STORE_SESSION, "readwrite", (store) => commitWrites(store, () => void store.put(entry)));
}

export async function readKnownCashSession(branchId: string): Promise<KnownCashSession | null> {
  const entry = await withStore(STORE_SESSION, "readonly", (store) =>
    runRequest<KnownCashSession>(store, store.get(branchId) as IDBRequest<KnownCashSession>),
  );
  return entry ?? null;
}

/* ------------------------------------------------------------------
   Fila de vendas pendentes
   ------------------------------------------------------------------ */

export async function readQueue(): Promise<PendingSale[]> {
  const rows = await withStore(STORE_QUEUE, "readonly", (store) =>
    runRequest<PendingSale[]>(store, store.getAll() as IDBRequest<PendingSale[]>),
  );
  return rows ?? [];
}

/**
 * Grava uma venda pendente e **confirma** que gravou.
 *
 * O `boolean` de volta não é decoração: é o que separa "a venda está
 * guardada" de uma mentira para o operador. Ver o cabeçalho deste arquivo.
 */
export async function writePendingSale(entry: PendingSale): Promise<boolean> {
  const ok = await withStore(STORE_QUEUE, "readwrite", (store) => commitWrites(store, () => void store.put(entry)));
  return ok === true;
}

export async function deletePendingSale(id: string): Promise<boolean> {
  const ok = await withStore(STORE_QUEUE, "readwrite", (store) => commitWrites(store, () => void store.delete(id)));
  return ok === true;
}

/** Regrava a fila inteira numa transação só — usado pelo conserto de `sincronizando` órfão na abertura do PDV. */
export async function writeQueue(queue: PendingSale[]): Promise<boolean> {
  if (queue.length === 0) return true;
  const ok = await withStore(STORE_QUEUE, "readwrite", (store) =>
    commitWrites(store, () => {
      for (const entry of queue) store.put(entry);
    }),
  );
  return ok === true;
}
