import { useMemo, useState } from "react";
import type { Contact } from "../customers/contacts";
import type { Product } from "../products/products";
import { createConditional } from "../../lib/repositories/conditionalsRepository";
import { extractErrorMessage } from "../sales/useInvoicesData";

export type ConditionalHeaderForm = {
  clienteId: string;
  clienteNome: string;
  dueDate: string;
};

function buildHeaderInicial(): ConditionalHeaderForm {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 7);
  return {
    clienteId: "",
    clienteNome: "",
    dueDate: dueDate.toISOString().slice(0, 10),
  };
}

export type ConditionalCartLine = {
  lineId: string;
  product: Product;
  quantity: number;
  unitPrice: number;
};

function lineTotal(line: ConditionalCartLine) {
  return Math.max(0, line.quantity * line.unitPrice);
}

type RemovedEntry = { line: ConditionalCartLine; index: number };

/** Estado do rascunho de uma condicional em andamento: cabeçalho + carrinho — mesmo formato de `useSaleOrderDraft`. */
export function useConditionalDraft(branchId: string | null) {
  const [header, setHeader] = useState<ConditionalHeaderForm>(buildHeaderInicial);
  const [cart, setCart] = useState<ConditionalCartLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ code: string; total: number } | null>(null);
  const [lastRemoved, setLastRemoved] = useState<RemovedEntry | null>(null);

  function setField<K extends keyof ConditionalHeaderForm>(field: K, value: ConditionalHeaderForm[K]) {
    setHeader((current) => ({ ...current, [field]: value }));
  }

  function selectContact(contact: Contact) {
    setHeader((current) => ({ ...current, clienteId: contact.id, clienteNome: contact.name }));
  }

  const headerValid = header.clienteId.trim() !== "" && header.dueDate.trim() !== "";

  function addProduct(product: Product) {
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...current, { lineId: crypto.randomUUID(), product, quantity: 1, unitPrice: product.salePrice }];
    });
  }

  function updateLine(lineId: string, patch: Partial<Pick<ConditionalCartLine, "quantity" | "unitPrice">>) {
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

  async function confirm() {
    if (!branchId) {
      setSubmitError("Nenhuma filial selecionada.");
      return;
    }
    if (!canConfirm) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createConditional({
        branchId,
        contactId: header.clienteId,
        dueDate: header.dueDate,
        items: cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      });
      setConfirmed({ code: created.code, total: created.total_amount });
    } catch (err) {
      setSubmitError(extractErrorMessage(err, "Não foi possível salvar a condicional."));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setHeader(buildHeaderInicial());
    setCart([]);
    setSubmitError(null);
    setConfirmed(null);
    setLastRemoved(null);
  }

  return {
    header,
    setField,
    selectContact,
    headerValid,
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
    confirmed,
    confirm,
    reset,
  };
}
