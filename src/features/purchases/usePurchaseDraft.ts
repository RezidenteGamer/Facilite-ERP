import { useEffect, useMemo, useState } from "react";
import type { Contact } from "../customers/contacts";
import type { Product } from "../products/products";
import { createPurchase, type CreatePurchaseInput } from "../../lib/repositories/purchasesRepository";
import type { SalePaymentMethod } from "../sales/sales";
import type { Purchase } from "./purchases";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

/** Métodos em que o fornecedor já recebe no ato — ver create_purchase (RPC). */
const PAID_ON_THE_SPOT: SalePaymentMethod[] = ["dinheiro", "pix", "debito"];

export type PurchaseHeaderForm = {
  fornecedorId: string;
  fornecedorNome: string;
  paymentMethod: SalePaymentMethod;
  installmentCount: number;
  firstDueDate: string;
  intervalDays: number;
  document: string;
  issueDate: string;
  entryDate: string;
  updateCostPrice: boolean;
};

/** Vencimento da 1ª parcela nasce sugerido em +30 dias — editável, nunca hardcoded na RPC (nota real tem prazo próprio). */
function buildHeaderInicial(): PurchaseHeaderForm {
  return {
    fornecedorId: "",
    fornecedorNome: "",
    paymentMethod: "boleto",
    installmentCount: 1,
    firstDueDate: addDaysIso(30),
    intervalDays: 30,
    document: "",
    issueDate: todayIso(),
    entryDate: todayIso(),
    updateCostPrice: true,
  };
}

export type PurchaseCartLine = {
  lineId: string;
  product: Product;
  quantity: number;
  unitCost: number;
};

function lineTotal(line: PurchaseCartLine) {
  return Math.max(0, line.quantity * line.unitCost);
}

type RemovedEntry = { line: PurchaseCartLine; index: number };

const UNDO_TIMEOUT_MS = 6000;

/** Mesmo padrão de `extractErrorMessage` de `useSaleOrderDraft.ts` — não reescrever mensagens que a RPC já manda prontas. */
function extractErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err && typeof err.message === "string"
        ? err.message
        : null;

  if (!raw) return "Não foi possível salvar a compra. Tente novamente — se o problema continuar, acione o suporte.";

  const KNOWN_MESSAGES = [
    "Sem permissão para criar compras.",
    "Sem acesso a esta filial.",
    "A compra precisa de ao menos um item.",
    "Fornecedor não encontrado.",
    "O contato selecionado não é um fornecedor.",
    "Produto não encontrado.",
    "Produto não pertence à filial da compra.",
    "Informe o vencimento da primeira parcela.",
  ];
  if (KNOWN_MESSAGES.includes(raw)) return raw;

  return "Não foi possível salvar a compra. Tente novamente — se o problema continuar, acione o suporte.";
}

/** Estado do rascunho de uma compra em andamento: cabeçalho + itens. Espelha `useSaleOrderDraft.ts`. */
export function usePurchaseDraft(branchId: string | null) {
  const [header, setHeader] = useState<PurchaseHeaderForm>(buildHeaderInicial);
  const [cart, setCart] = useState<PurchaseCartLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedPurchase, setConfirmedPurchase] = useState<Purchase | null>(null);
  const [lastRemoved, setLastRemoved] = useState<RemovedEntry | null>(null);

  useEffect(() => {
    if (!lastRemoved) return;
    const timer = window.setTimeout(() => setLastRemoved(null), UNDO_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [lastRemoved]);

  function setField<K extends keyof PurchaseHeaderForm>(field: K, value: PurchaseHeaderForm[K]) {
    setHeader((current) => ({ ...current, [field]: value }));
  }

  function selectContact(contact: Contact) {
    setHeader((current) => ({ ...current, fornecedorId: contact.id, fornecedorNome: contact.name }));
  }

  const isPaidOnTheSpot = PAID_ON_THE_SPOT.includes(header.paymentMethod);
  const headerValid = header.fornecedorId.trim() !== "" && (isPaidOnTheSpot || header.firstDueDate.trim() !== "");

  function addProduct(product: Product) {
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        { lineId: crypto.randomUUID(), product, quantity: 1, unitCost: product.costPrice ?? 0 },
      ];
    });
  }

  function updateLine(lineId: string, patch: Partial<Pick<PurchaseCartLine, "quantity" | "unitCost">>) {
    setCart((current) => current.map((line) => (line.lineId === lineId ? { ...line, ...patch } : line)));
  }

  function removeLine(lineId: string) {
    const index = cart.findIndex((line) => line.lineId === lineId);
    if (index === -1) return;
    setLastRemoved({ line: cart[index], index });
    setCart((current) => current.filter((line) => line.lineId !== lineId));
  }

  function undoRemove() {
    if (!lastRemoved) return;
    const { line, index } = lastRemoved;
    setCart((current) => {
      const next = [...current];
      next.splice(Math.min(index, next.length), 0, line);
      return next;
    });
    setLastRemoved(null);
  }

  const total = useMemo(() => cart.reduce((sum, line) => sum + lineTotal(line), 0), [cart]);

  const canConfirm = headerValid && cart.length > 0 && !submitting;

  async function confirmPurchase() {
    if (!branchId) {
      setSubmitError("Nenhuma filial selecionada.");
      return;
    }
    if (!canConfirm) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const input: CreatePurchaseInput = {
        branchId,
        contactId: header.fornecedorId,
        paymentMethod: header.paymentMethod,
        installmentCount: header.installmentCount,
        firstDueDate: isPaidOnTheSpot ? undefined : header.firstDueDate,
        intervalDays: header.intervalDays,
        document: header.document,
        issueDate: header.issueDate,
        entryDate: header.entryDate,
        updateCostPrice: header.updateCostPrice,
        items: cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          unitCost: line.unitCost,
        })),
      };
      const purchase = await createPurchase(input);
      setConfirmedPurchase(purchase);
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setHeader(buildHeaderInicial());
    setCart([]);
    setSubmitError(null);
    setConfirmedPurchase(null);
    setLastRemoved(null);
  }

  return {
    header,
    setField,
    selectContact,
    headerValid,
    isPaidOnTheSpot,
    cart,
    addProduct,
    updateLine,
    removeLine,
    lineTotal,
    lastRemoved,
    undoRemove,
    total,
    canConfirm,
    submitting,
    submitError,
    confirmedPurchase,
    confirmPurchase,
    reset,
  };
}
