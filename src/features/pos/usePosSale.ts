import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseAmount } from "../../lib/amount";
import { claimTurn } from "../../lib/latestTurn";
import type { Contact } from "../customers/contacts";
import type { Product } from "../products/products";
import { createPosSale } from "../../lib/repositories/posRepository";
import { isNetworkFailure } from "../../lib/repositories/postgrestFailure";
import type { CreateSaleInput } from "../../lib/repositories/salesRepository";
import { getOpenCashSession } from "../../lib/repositories/cashControlRepository";
import { readKnownCashSession, saveKnownCashSession } from "./offlineStore";
import { shortPendingCode, type PendingSale } from "./offlineQueue";
import { NO_OPEN_SESSION_ERROR, posSaleErrorMessage } from "./saleErrors";
import type { CashSession } from "../cashcontrol/cashControl";
import type { Sale, SalePaymentMethod } from "../sales/sales";
import { emitFiscalDocumentForSale } from "./fiscalDocument";
import { buildPosReceiptSnapshot, type PosReceiptSnapshot } from "./receipt";

export type PosCartLine = {
  lineId: string;
  product: Product;
  quantity: number;
};

/** Formas aceitas no PDV — sem boleto/"outro" (não fazem sentido num caixa físico). */
export type PosPaymentMethod = "dinheiro" | "debito" | "credito" | "pix";

export type PosSplitLine = {
  lineId: string;
  method: PosPaymentMethod;
  /**
   * Texto, não número — de propósito, mesma correção de `PaymentLine` em
   * `useSaleDraft.ts`: um input controlado que mostra `String(number)`
   * reescreve o campo a cada tecla, e a vírgula digitada desaparecia antes
   * do segundo dígito decimal ser digitado.
   */
  amount: string;
  installments: number;
};

/** Snapshot de uma venda pausada — os mesmos campos do rascunho atual, mais id e horário pra listar na hora de retomar. */
export type PosPausedSale = {
  id: string;
  pausedAt: number;
  cart: PosCartLine[];
  contact: Contact | null;
  discount: string;
  discountMode: "percent" | "value";
  method: PosPaymentMethod | "dividir";
  received: string;
  installments: number;
  splitLines: PosSplitLine[];
  total: number;
};

/**
 * Sessão de caixa aberta da filial — o PDV bloqueia "Confirmar Venda" sem ela
 * (ver AGENTS.md).
 *
 * ## O que mudou em E6, e por quê
 *
 * Até 10/09/2026 este hook tinha um `catch { setSession(null) }`. Parece
 * inofensivo e não é: `session = null` é **exatamente** o estado "não há
 * sessão de caixa aberta", que bloqueia a venda. Ou seja, cair a rede
 * produzia a mesma resposta que fechar o caixa — e o PDV parava de vender
 * numa loja onde o caixa estava aberto o tempo todo. É a reclamação literal
 * do plano desta tarefa.
 *
 * Agora a falha de rede é separada da recusa do banco
 * (`postgrestFailure.ts`), e sem rede o PDV cai no **último estado que o
 * servidor confirmou**, guardado no IndexedDB. `assumed: true` acompanha esse
 * estado até a próxima confirmação de verdade.
 *
 * ## A aposta que `assumed` representa, dita em voz alta
 *
 * Último estado conhecido **não é** estado atual. Entre a última confirmação
 * e agora, alguém pode ter fechado a sessão pelo Controle de Caixa em outra
 * máquina. Vender em cima dessa suposição significa que, na hora de
 * sincronizar, `create_pos_sale` pode responder "Abra uma sessão de caixa
 * antes de vender." para uma venda que já foi paga e já saiu da loja.
 *
 * A alternativa — bloquear por precaução — foi descartada de propósito:
 * bloquear sem rede é o comportamento de hoje, é o problema que E6 existe
 * para resolver, e deixaria a tarefa inteira sem efeito prático. O preço da
 * escolha é aquela recusa tardia, que **não some em silêncio**: vira uma
 * venda `falhou` na fila, visível na tela até alguém resolver. Decisão e
 * risco registrados em AGENTS.md.
 */
export function useOpenCashSession(branchId: string | null) {
  const [session, setSession] = useState<CashSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [assumed, setAssumed] = useState(false);
  /** Quando o estado suposto foi confirmado pela última vez — a tela mostra a hora. */
  const [assumedAt, setAssumedAt] = useState<number | null>(null);

  /**
   * Senha da vez da leitura em curso. Só a mais recente tem direito de
   * escrever o que descobriu.
   *
   * O `reload` abaixo é `async` e atravessa dois `await`, e nada cancelava
   * uma leitura já disparada: trocar de filial (ou confirmar uma venda, que
   * também chama `reload`) deixava **duas** em voo, e quem escrevia por
   * último era quem respondesse por último — não quem tivesse sido pedido por
   * último. O resultado possível era o PDV mostrando a sessão da filial
   * anterior enquanto `branchId` já era a nova, e `canConfirm` liberando uma
   * venda na filial B com base no caixa da filial A.
   *
   * O contador também resolve o outro lado: uma leitura atrasada não pode
   * apagar o `loading` de uma leitura mais nova que ainda está em voo.
   *
   * A regra em si mora em `lib/latestTurn.ts`, onde dá para testá-la — aqui
   * dentro de um hook, não daria (os testes deste projeto rodam em `node`,
   * sem DOM).
   */
  const turno = useRef(0);

  const reload = useCallback(async () => {
    /** Esta leitura ainda é a mais recente? Se não, tudo o que ela descobriu é passado. */
    const aindaValho = claimTurn(turno);

    if (!branchId) {
      setSession(null);
      setAssumed(false);
      setAssumedAt(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const atual = await getOpenCashSession(branchId);
      if (!aindaValho()) return;
      setSession(atual);
      setAssumed(false);
      setAssumedAt(null);
      /*
       * O snapshot também fica de fora quando esta leitura foi superada, e é
       * de propósito. Numa troca de filial o que se perde é só não refrescar
       * o snapshot da filial abandonada — ele volta a ser gravado na próxima
       * vez que ela for aberta. Já gravar assim mesmo teria um caso ruim de
       * verdade: duas leituras da MESMA filial em voo (trocar de filial e
       * voltar, ou confirmar uma venda no meio), com a mais velha chegando
       * por último e gravando "caixa aberto" por cima do "caixa fechado" que
       * a mais nova já tinha visto. O PDV passaria a vender offline contra
       * uma sessão que ele sabia estar fechada.
       */
      await saveKnownCashSession(branchId, atual);
    } catch (err) {
      if (!aindaValho()) return;
      if (!isNetworkFailure(err)) {
        // Recusa de verdade (sem permissão, sem acesso à filial): tratar como
        // "não há sessão" continua certo — não é falta de informação, é uma
        // resposta.
        setSession(null);
        setAssumed(false);
        setAssumedAt(null);
        return;
      }
      const conhecida = await readKnownCashSession(branchId);
      if (!aindaValho()) return;
      setSession(conhecida?.session ?? null);
      setAssumed(conhecida?.session != null);
      setAssumedAt(conhecida?.session != null ? conhecida.savedAt : null);
    } finally {
      if (aindaValho()) setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { session, loading, assumed, assumedAt, reload };
}

/** Nome/CNPJ da filial pra imprimir no cabeçalho do cupom (E1) — `null` quando ainda não carregou. */
export type PosStoreInfo = { name: string; document: string | null };

/**
 * Estado de uma venda em andamento no PDV: carrinho + cliente (opcional) +
 * pagamento. `sellerId` chega de quem está logado — o PDV não tem seletor de
 * vendedor (ver AGENTS.md).
 */
/**
 * A porta da fila offline, vista de dentro de `usePosSale`. Quem implementa é
 * `useOfflineSales.ts`; aqui só interessa "consegue guardar esta venda?".
 * Passar como argumento, e não importar o hook direto, mantém `usePosSale`
 * testável e deixa um só lugar dono da fila na tela (`PosPage`).
 */
export type PosOfflineQueue = {
  enqueueSale: (payload: CreateSaleInput, totalAmount: number) => Promise<PendingSale | null>;
};

export function usePosSale(
  branchId: string | null,
  sellerId: string | null,
  storeInfo: PosStoreInfo | null,
  offline: PosOfflineQueue,
) {
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [discount, setDiscount] = useState("");
  const [discountMode, setDiscountMode] = useState<"percent" | "value">("percent");
  const [method, setMethod] = useState<PosPaymentMethod | "dividir">("dinheiro");
  const [received, setReceived] = useState("");
  const [installments, setInstallments] = useState(1);
  const [splitLines, setSplitLines] = useState<PosSplitLine[]>([]);
  const [pausedSales, setPausedSales] = useState<PosPausedSale[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedSale, setConfirmedSale] = useState<Sale | null>(null);
  /**
   * Snapshot do cupom da última venda confirmada — sobrevive ao `reset()`
   * de propósito (ver `receipt.ts`), diferente de `confirmedSale` (que some
   * sozinho em 5s). É o que permite reimprimir depois que o carrinho já foi
   * limpo pra próxima venda.
   */
  const [lastReceipt, setLastReceipt] = useState<PosReceiptSnapshot | null>(null);
  /**
   * Aviso não bloqueante de falha na emissão da NFC-e — separado de
   * `submitError` de propósito: a venda já foi confirmada quando isto pode
   * acontecer, então não é "a venda falhou", é "a venda foi, a nota não saiu"
   * (ver `fiscalDocument.ts`).
   */
  const [fiscalWarning, setFiscalWarning] = useState<string | null>(null);
  /**
   * "Esta venda ficou na fila" — estado próprio, nem `confirmedSale` nem
   * `submitError`, porque não é nenhum dos dois. A venda não está gravada no
   * sistema (então dizer "confirmada" seria mentira), e nada deu errado do
   * ponto de vista do operador (então um erro vermelho mandaria ele refazer
   * uma venda que já está guardada — e aí sim haveria venda duplicada).
   */
  const [queuedSale, setQueuedSale] = useState<PendingSale | null>(null);

  // A confirmação vira um aviso passageiro, não uma tela nova — o operador
  // já está de olho no carrinho vazio pronto pra próxima venda.
  useEffect(() => {
    if (!confirmedSale) return;
    const timer = window.setTimeout(() => setConfirmedSale(null), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmedSale]);

  useEffect(() => {
    if (!queuedSale) return;
    const timer = window.setTimeout(() => setQueuedSale(null), 8000);
    return () => window.clearTimeout(timer);
  }, [queuedSale]);

  function addProduct(product: Product) {
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...current, { lineId: crypto.randomUUID(), product, quantity: 1 }];
    });
  }

  function changeQuantity(lineId: string, delta: number) {
    setCart((current) =>
      current
        .map((line) => (line.lineId === lineId ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  function removeLast() {
    setCart((current) => current.slice(0, -1));
  }

  function clearCart() {
    setCart([]);
  }

  const subtotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.product.salePrice * line.quantity, 0),
    [cart],
  );
  const discountValueRaw = Math.max(0, parseAmount(discount) ?? 0);
  const discountValue = discountMode === "percent" ? Math.min(discountValueRaw, 100) : discountValueRaw;
  const discountAmount = discountMode === "percent" ? subtotal * (discountValue / 100) : discountValue;
  const total = Math.max(0, subtotal - discountAmount);

  const receivedValue = Number(received.replace(",", ".")) || 0;
  const troco = Math.max(0, receivedValue - total);

  function addSplitLine() {
    setSplitLines((current) => [
      ...current,
      { lineId: crypto.randomUUID(), method: "dinheiro", amount: "", installments: 1 },
    ]);
  }

  function updateSplitLine(
    lineId: string,
    patch: Partial<Pick<PosSplitLine, "method" | "amount" | "installments">>,
  ) {
    setSplitLines((current) => current.map((line) => (line.lineId === lineId ? { ...line, ...patch } : line)));
  }

  function removeSplitLine(lineId: string) {
    setSplitLines((current) => current.filter((line) => line.lineId !== lineId));
  }

  const splitTotal = useMemo(
    () => splitLines.reduce((sum, line) => sum + (parseAmount(line.amount) ?? 0), 0),
    [splitLines],
  );
  const splitMatches = splitLines.length > 0 && Math.abs(splitTotal - total) < 0.01;

  /** Trocar para "Dividir" já nasce com 2 linhas — evita o operador ter que descobrir o botão "+ linha" na primeira vez. */
  function selectMethod(next: PosPaymentMethod | "dividir") {
    setMethod(next);
    if (next === "dividir" && splitLines.length === 0) {
      setSplitLines([
        { lineId: crypto.randomUUID(), method: "dinheiro", amount: "", installments: 1 },
        { lineId: crypto.randomUUID(), method: "credito", amount: "", installments: 1 },
      ]);
    }
  }

  const paymentValid = cart.length > 0 && (method === "dividir" ? splitMatches : true);

  function buildPayments(): { method: SalePaymentMethod; amount: number; installments: number }[] {
    if (method === "dividir") {
      return splitLines.map((line) => ({
        method: line.method,
        amount: parseAmount(line.amount) ?? 0,
        installments: line.method === "credito" ? line.installments : 1,
      }));
    }
    return [{ method, amount: total, installments: method === "credito" ? installments : 1 }];
  }

  function reset() {
    setCart([]);
    setContact(null);
    setDiscount("");
    setReceived("");
    setInstallments(1);
    setSplitLines([]);
    setMethod("dinheiro");
  }

  /** Empilha o rascunho atual em `pausedSales` e limpa a venda atual. Nada a fazer com carrinho vazio. */
  function pauseSale() {
    if (cart.length === 0) return;
    setPausedSales((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        pausedAt: Date.now(),
        cart,
        contact,
        discount,
        discountMode,
        method,
        received,
        installments,
        splitLines,
        total,
      },
    ]);
    reset();
  }

  /**
   * Restaura o snapshot `id` como venda atual. Se já houver uma venda em
   * andamento (carrinho não vazio), ela é pausada automaticamente antes de
   * carregar a escolhida — evita descartar itens silenciosamente e evita um
   * segundo diálogo de confirmação só pra trocar de venda pausada.
   */
  function resumeSale(id: string) {
    const target = pausedSales.find((paused) => paused.id === id);
    if (!target) return;

    if (cart.length > 0) {
      const currentSnapshot: PosPausedSale = {
        id: crypto.randomUUID(),
        pausedAt: Date.now(),
        cart,
        contact,
        discount,
        discountMode,
        method,
        received,
        installments,
        splitLines,
        total,
      };
      setPausedSales((current) => [...current.filter((paused) => paused.id !== id), currentSnapshot]);
    } else {
      setPausedSales((current) => current.filter((paused) => paused.id !== id));
    }

    setCart(target.cart);
    setContact(target.contact);
    setDiscount(target.discount);
    setDiscountMode(target.discountMode);
    setMethod(target.method);
    setReceived(target.received);
    setInstallments(target.installments);
    setSplitLines(target.splitLines);
  }

  /**
   * Monta o cupom da venda que acabou de sair. Precisa ser chamada **antes**
   * de `reset()` — `cart`/`total`/`troco` ainda são os da venda. Ver
   * `receipt.ts`.
   */
  function snapshotDoCupom(
    saleCode: string,
    payments: { method: SalePaymentMethod; amount: number; installments: number }[],
    notice: string | null,
  ) {
    return buildPosReceiptSnapshot({
      saleCode,
      issuedAt: new Date(),
      cart,
      subtotalAmount: subtotal,
      discountAmount,
      totalAmount: total,
      payments,
      changeAmount: method === "dinheiro" ? troco : null,
      storeName: storeInfo?.name ?? "Facilite",
      storeDocument: storeInfo?.document ?? null,
      notice,
    });
  }

  async function confirmSale(hasOpenSession: boolean) {
    if (!branchId || !sellerId) {
      setSubmitError("Nenhuma filial ou operador identificado.");
      return;
    }
    if (!hasOpenSession) {
      setSubmitError(NO_OPEN_SESSION_ERROR);
      return;
    }
    if (!paymentValid || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setFiscalWarning(null);
    setQueuedSale(null);
    const payments = buildPayments();
    const payload: CreateSaleInput = {
      branchId,
      contactId: contact?.id ?? null,
      sellerId,
      issueDate: new Date().toISOString().slice(0, 10),
      discountAmount,
      items: cart.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        unitPrice: line.product.salePrice,
      })),
      payments,
    };
    try {
      const sale = await createPosSale(payload);
      setConfirmedSale(sale);
      // Capturado ANTES do reset() de propósito — ver o comentário de
      // `lastReceipt` acima e `receipt.ts`. `cart`/`subtotal`/`total` daqui
      // pra baixo ainda são os da venda que acabou de confirmar.
      setLastReceipt(snapshotDoCupom(sale.code, payments, null));
      reset();
      // A venda já está confirmada aqui — `emitFiscalDocumentForSale` nunca
      // lança (ver fiscalDocument.ts), então uma falha de NFC-e vira aviso
      // não bloqueante, nunca `submitError` (que significaria "venda falhou").
      const fiscalOutcome = await emitFiscalDocumentForSale(sale.id, branchId);
      if (!fiscalOutcome.ok) {
        setFiscalWarning(`Venda confirmada, mas a NFC-e não saiu: ${fiscalOutcome.errors.join(" ")}`);
      }
    } catch (err) {
      /*
       * A bifurcação de E6, e a única linha desta tela onde a diferença entre
       * "a rede caiu" e "o banco recusou" vale dinheiro.
       *
       * Rede: a venda vai para a fila e o caixa segue trabalhando. Recusa de
       * negócio (estoque acabou, sessão fechada, sem permissão, desconto
       * acima do teto): erro na cara do operador, agora, porque enfileirar
       * daria exatamente a mesma recusa depois — só que tarde demais, com o
       * cliente já na rua. A classificação vem do `status` da resposta, não
       * da mensagem do navegador; ver `postgrestFailure.ts`.
       */
      if (!isNetworkFailure(err)) {
        setSubmitError(
          posSaleErrorMessage(err, (productId) => cart.find((line) => line.product.id === productId)?.product.description ?? null),
        );
        return;
      }

      const pendente = await offline.enqueueSale(payload, total);
      if (!pendente) {
        /*
         * Sem rede E sem onde guardar. É o único caminho em que o PDV precisa
         * dizer "não deu" mesmo estando offline: prometer que guardou uma
         * venda que vive só na memória desta aba seria perder dinheiro no
         * primeiro F5. Ver `offlineStore.ts`.
         */
        setSubmitError(
          "Sem conexão e sem como guardar a venda neste computador — o navegador está bloqueando o armazenamento local. Anote a venda no papel e lance depois.",
        );
        return;
      }

      setQueuedSale(pendente);
      // Cupom sai igual: a impressora é USB (E1) e não depende de rede
      // nenhuma. O código impresso é o da fila, não um `sales.code` inventado
      // — ver `shortPendingCode`.
      setLastReceipt(
        snapshotDoCupom(shortPendingCode(pendente.id), payments, "VENDA PENDENTE DE SINCRONIZACAO"),
      );
      reset();
      // Nenhuma NFC-e aqui de propósito: não existe venda no banco para a
      // Edge Function `fiscal-emit` ler. A emissão acontece depois que a
      // venda sincronizar de verdade (`useOfflineSales.ts`).
    } finally {
      setSubmitting(false);
    }
  }

  return {
    cart,
    addProduct,
    changeQuantity,
    removeLast,
    clearCart,
    contact,
    setContact,
    discount,
    setDiscount,
    discountMode,
    setDiscountMode,
    method,
    selectMethod,
    received,
    setReceived,
    installments,
    setInstallments,
    splitLines,
    addSplitLine,
    updateSplitLine,
    removeSplitLine,
    splitTotal,
    splitMatches,
    pausedSales,
    pauseSale,
    resumeSale,
    subtotal,
    discountAmount,
    total,
    troco,
    paymentValid,
    submitting,
    submitError,
    confirmedSale,
    queuedSale,
    fiscalWarning,
    lastReceipt,
    confirmSale,
    reset,
  };
}
