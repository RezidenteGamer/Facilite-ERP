import { useCallback, useEffect, useMemo, useState } from "react";
import type { Contact } from "../customers/contacts";
import type { Product } from "../products/products";
import { createPosSale } from "../../lib/repositories/posRepository";
import { getOpenCashSession } from "../../lib/repositories/cashControlRepository";
import type { CashSession } from "../cashcontrol/cashControl";
import { formatMoney } from "./pos";
import type { Sale, SalePaymentMethod } from "../sales/sales";
import { emitFiscalDocumentForSale } from "./fiscalDocument";

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
  amount: number;
  installments: number;
};

const STOCK_ERROR = /^Estoque insuficiente para o produto ([0-9a-f-]{36})\.$/i;
const PAYMENTS_MISMATCH_ERROR =
  /^A soma dos pagamentos \(([\d.,-]+)\) não bate com o total da venda \(([\d.,-]+)\)\.$/;
export const NO_OPEN_SESSION_ERROR = "Abra uma sessão de caixa antes de vender.";

/**
 * `create_pos_sale`/`create_sale` já levantam mensagens em português prontas
 * — mesmo tratamento de `useSaleDraft.ts` (Realizar Venda): só traduzimos o
 * erro de estoque (a RPC só tem o id do produto) e blindamos contra erro cru
 * não previsto.
 */
function extractErrorMessage(err: unknown, cart: PosCartLine[]): string {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err && typeof err.message === "string"
        ? err.message
        : null;

  if (!raw) return "Não foi possível confirmar a venda. Tente novamente — se o problema continuar, acione o suporte.";

  if (raw === NO_OPEN_SESSION_ERROR) return raw;

  const stockMatch = raw.match(STOCK_ERROR);
  if (stockMatch) {
    const product = cart.find((line) => line.product.id === stockMatch[1])?.product;
    return product
      ? `Estoque insuficiente para "${product.description}" — reduza a quantidade ou remova o item.`
      : "Estoque insuficiente para um dos produtos da venda.";
  }

  const mismatchMatch = raw.match(PAYMENTS_MISMATCH_ERROR);
  if (mismatchMatch) {
    const paid = Number(mismatchMatch[1].replace(",", "."));
    const total = Number(mismatchMatch[2].replace(",", "."));
    return `A soma dos pagamentos (${formatMoney(paid)}) não bate com o total da venda (${formatMoney(total)}).`;
  }

  const KNOWN_MESSAGES = [
    "Sem permissão para vender no ponto de venda.",
    "Sem permissão para criar vendas.",
    "Sem acesso a esta filial.",
    "A venda precisa de ao menos um item.",
    "A venda precisa de ao menos uma forma de pagamento.",
    "Produto não encontrado.",
    "Produto não pertence à filial da venda.",
  ];
  if (KNOWN_MESSAGES.includes(raw)) return raw;

  return "Não foi possível confirmar a venda. Tente novamente — se o problema continuar, acione o suporte.";
}

/** Sessão de caixa aberta da filial — o PDV bloqueia "Confirmar Venda" sem ela (ver AGENTS.md). */
export function useOpenCashSession(branchId: string | null) {
  const [session, setSession] = useState<CashSession | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!branchId) {
      setSession(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setSession(await getOpenCashSession(branchId));
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { session, loading, reload };
}

/**
 * Estado de uma venda em andamento no PDV: carrinho + cliente (opcional) +
 * pagamento. `sellerId` chega de quem está logado — o PDV não tem seletor de
 * vendedor (ver AGENTS.md).
 */
export function usePosSale(branchId: string | null, sellerId: string | null) {
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [discount, setDiscount] = useState("");
  const [discountMode, setDiscountMode] = useState<"percent" | "value">("percent");
  const [method, setMethod] = useState<PosPaymentMethod | "dividir">("dinheiro");
  const [received, setReceived] = useState("");
  const [installments, setInstallments] = useState(1);
  const [splitLines, setSplitLines] = useState<PosSplitLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedSale, setConfirmedSale] = useState<Sale | null>(null);
  /**
   * Aviso não bloqueante de falha na emissão da NFC-e — separado de
   * `submitError` de propósito: a venda já foi confirmada quando isto pode
   * acontecer, então não é "a venda falhou", é "a venda foi, a nota não saiu"
   * (ver `fiscalDocument.ts`).
   */
  const [fiscalWarning, setFiscalWarning] = useState<string | null>(null);

  // A confirmação vira um aviso passageiro, não uma tela nova — o operador
  // já está de olho no carrinho vazio pronto pra próxima venda.
  useEffect(() => {
    if (!confirmedSale) return;
    const timer = window.setTimeout(() => setConfirmedSale(null), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmedSale]);

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
  const discountValueRaw = Math.max(0, Number(discount.replace(",", ".")) || 0);
  const discountValue = discountMode === "percent" ? Math.min(discountValueRaw, 100) : discountValueRaw;
  const discountAmount = discountMode === "percent" ? subtotal * (discountValue / 100) : discountValue;
  const total = Math.max(0, subtotal - discountAmount);

  const receivedValue = Number(received.replace(",", ".")) || 0;
  const troco = Math.max(0, receivedValue - total);

  function addSplitLine() {
    setSplitLines((current) => [
      ...current,
      { lineId: crypto.randomUUID(), method: "dinheiro", amount: 0, installments: 1 },
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

  const splitTotal = useMemo(() => splitLines.reduce((sum, line) => sum + line.amount, 0), [splitLines]);
  const splitMatches = splitLines.length > 0 && Math.abs(splitTotal - total) < 0.01;

  /** Trocar para "Dividir" já nasce com 2 linhas — evita o operador ter que descobrir o botão "+ linha" na primeira vez. */
  function selectMethod(next: PosPaymentMethod | "dividir") {
    setMethod(next);
    if (next === "dividir" && splitLines.length === 0) {
      setSplitLines([
        { lineId: crypto.randomUUID(), method: "dinheiro", amount: 0, installments: 1 },
        { lineId: crypto.randomUUID(), method: "credito", amount: 0, installments: 1 },
      ]);
    }
  }

  const paymentValid = cart.length > 0 && (method === "dividir" ? splitMatches : true);

  function buildPayments(): { method: SalePaymentMethod; amount: number; installments: number }[] {
    if (method === "dividir") {
      return splitLines.map((line) => ({
        method: line.method,
        amount: line.amount,
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
    try {
      const sale = await createPosSale({
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
        payments: buildPayments(),
      });
      setConfirmedSale(sale);
      reset();
      // A venda já está confirmada aqui — `emitFiscalDocumentForSale` nunca
      // lança (ver fiscalDocument.ts), então uma falha de NFC-e vira aviso
      // não bloqueante, nunca `submitError` (que significaria "venda falhou").
      const fiscalOutcome = await emitFiscalDocumentForSale(sale.id, branchId);
      if (!fiscalOutcome.ok) {
        setFiscalWarning(`Venda confirmada, mas a NFC-e não saiu: ${fiscalOutcome.errors.join(" ")}`);
      }
    } catch (err) {
      setSubmitError(extractErrorMessage(err, cart));
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
    subtotal,
    discountAmount,
    total,
    troco,
    paymentValid,
    submitting,
    submitError,
    confirmedSale,
    fiscalWarning,
    confirmSale,
    reset,
  };
}
