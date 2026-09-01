import { useEffect, useMemo, useState } from "react";
import { useOpenWindows } from "../../components/openWindows";
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

/** Slot do rascunho dentro do estado da janela — ver `openWindows.tsx`. */
const DRAFT_SLOT = "conditional-draft";

/** O que sobrevive a uma troca de janela — mesmo critério de `PersistedSaleDraft` em `useSaleDraft.ts`. */
type PersistedConditionalDraft = {
  header: ConditionalHeaderForm;
  cart: ConditionalCartLine[];
};

/**
 * Estado do rascunho de uma condicional em andamento: cabeçalho + carrinho —
 * mesmo formato de `useSaleOrderDraft`. `windowId` é o mesmo id passado a
 * `openWindow`: com ele o rascunho sobrevive a ir em outra janela e voltar —
 * ver a decisão "estado por janela no `OpenWindowsProvider`" em AGENTS.md.
 */
export function useConditionalDraft(branchId: string | null, windowId?: string | null) {
  const { getWindowState, setWindowState, clearWindowState } = useOpenWindows();
  const [restored] = useState(() =>
    windowId ? getWindowState<PersistedConditionalDraft>(windowId, DRAFT_SLOT) : undefined,
  );

  const [header, setHeader] = useState<ConditionalHeaderForm>(() => restored?.header ?? buildHeaderInicial());
  const [cart, setCart] = useState<ConditionalCartLine[]>(() => restored?.cart ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ code: string; total: number } | null>(null);
  const [lastRemoved, setLastRemoved] = useState<RemovedEntry | null>(null);

  /* Espelha o rascunho no estado da janela a cada mudança — mesmo raciocínio
     do efeito equivalente em `useSaleDraft.ts`. A condicional confirmada é o
     outro fim de vida: `confirmed` não zera o rascunho (a tela de sucesso
     ainda mostra o que foi salvo), então, se este efeito continuasse
     gravando, abrir "Condicionais" de novo ressuscitaria a condicional que
     acabou de ser salva — aqui o rascunho acaba, limpa em vez de gravar. */
  useEffect(() => {
    if (!windowId) return;
    if (confirmed) {
      clearWindowState(windowId);
      return;
    }
    setWindowState<PersistedConditionalDraft>(windowId, DRAFT_SLOT, { header, cart });
  }, [windowId, confirmed, header, cart, setWindowState, clearWindowState]);

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

  // `unitPrice` não entra no patch — a RPC lê o preço sempre de
  // `products.sale_price` (tarefa C3, 29/08/2026).
  function updateLine(lineId: string, patch: Partial<Pick<ConditionalCartLine, "quantity">>) {
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
