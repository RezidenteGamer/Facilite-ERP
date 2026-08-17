import { useEffect, useMemo, useState } from "react";
import type { Contact } from "../customers/contacts";
import type { Product } from "../products/products";
import { createSaleOrder, type CreateSaleOrderInput } from "../../lib/repositories/saleOrdersRepository";
import type { SaleSeller } from "../../lib/repositories/salesLookups";
import type { SaleOrder } from "./saleOrders";
import type { SalePaymentMethod } from "./sales";

export type SaleOrderHeaderForm = {
  clienteId: string;
  clienteNome: string;
  vendedorId: string;
  vendedorNome: string;
  paymentMethod: SalePaymentMethod;
  installments: number;
  issueDate: string;
};

/** Vendedor nasce preenchido com quem está logado — mesmo raciocínio de `useSaleDraft`. */
function buildHeaderInicial(defaultSeller?: SaleSeller | null): SaleOrderHeaderForm {
  return {
    clienteId: "",
    clienteNome: "",
    vendedorId: defaultSeller?.id ?? "",
    vendedorNome: defaultSeller?.name ?? "",
    paymentMethod: "dinheiro",
    installments: 1,
    issueDate: new Date().toISOString().slice(0, 10),
  };
}

export type SaleOrderCartLine = {
  lineId: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
};

function lineTotal(line: SaleOrderCartLine) {
  return Math.max(0, line.quantity * line.unitPrice - line.discountAmount);
}

type RemovedEntry = { line: SaleOrderCartLine; index: number };

const UNDO_TIMEOUT_MS = 6000;

/**
 * Pedido não valida estoque nem soma de pagamentos (só reserva no papel — ver
 * decisão em AGENTS.md), então as únicas mensagens conhecidas da RPC são as
 * de permissão/filial/item obrigatório/produto. Mesmo padrão de
 * `extractErrorMessage` de `useSaleDraft.ts` — não reescrever mensagens que a
 * RPC já manda prontas.
 */
function extractErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err && typeof err.message === "string"
        ? err.message
        : null;

  if (!raw) return "Não foi possível salvar o pedido. Tente novamente — se o problema continuar, acione o suporte.";

  const KNOWN_MESSAGES = [
    "Sem permissão para criar pedidos de venda.",
    "Sem acesso a esta filial.",
    "O pedido precisa de ao menos um item.",
    "Produto não encontrado.",
    "Produto não pertence à filial do pedido.",
  ];
  if (KNOWN_MESSAGES.includes(raw)) return raw;

  return "Não foi possível salvar o pedido. Tente novamente — se o problema continuar, acione o suporte.";
}

/** Estado do rascunho de um pedido em andamento: cabeçalho + carrinho. Sem split de pagamento — ver AGENTS.md. */
export function useSaleOrderDraft(branchId: string | null, defaultSeller?: SaleSeller | null) {
  const [header, setHeader] = useState<SaleOrderHeaderForm>(() => buildHeaderInicial(defaultSeller));
  const [cart, setCart] = useState<SaleOrderCartLine[]>([]);
  const [freight, setFreight] = useState("");
  const [discount, setDiscount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<SaleOrder | null>(null);
  const [lastRemoved, setLastRemoved] = useState<RemovedEntry | null>(null);

  useEffect(() => {
    if (!lastRemoved) return;
    const timer = window.setTimeout(() => setLastRemoved(null), UNDO_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [lastRemoved]);

  useEffect(() => {
    if (!defaultSeller) return;
    setHeader((current) =>
      current.vendedorId ? current : { ...current, vendedorId: defaultSeller.id, vendedorNome: defaultSeller.name },
    );
  }, [defaultSeller]);

  function setField<K extends keyof SaleOrderHeaderForm>(field: K, value: SaleOrderHeaderForm[K]) {
    setHeader((current) => ({ ...current, [field]: value }));
  }

  function selectContact(contact: Contact) {
    setHeader((current) => ({ ...current, clienteId: contact.id, clienteNome: contact.name }));
  }

  function selectSeller(seller: SaleSeller) {
    setHeader((current) => ({ ...current, vendedorId: seller.id, vendedorNome: seller.name }));
  }

  const headerValid = header.clienteId.trim() !== "" && header.vendedorId.trim() !== "";

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
        { lineId: crypto.randomUUID(), product, quantity: 1, unitPrice: product.salePrice, discountAmount: 0 },
      ];
    });
  }

  function updateLine(lineId: string, patch: Partial<Pick<SaleOrderCartLine, "quantity" | "unitPrice" | "discountAmount">>) {
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

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + lineTotal(line), 0), [cart]);
  const freightValue = Math.max(0, Number(freight.replace(",", ".")) || 0);
  const discountValue = Math.max(0, Number(discount.replace(",", ".")) || 0);
  const total = Math.max(0, subtotal + freightValue - discountValue);

  const canConfirm = headerValid && cart.length > 0 && !submitting;

  async function confirmOrder() {
    if (!branchId) {
      setSubmitError("Nenhuma filial selecionada.");
      return;
    }
    if (!canConfirm) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const input: CreateSaleOrderInput = {
        branchId,
        contactId: header.clienteId,
        sellerId: header.vendedorId,
        paymentMethod: header.paymentMethod,
        installments: header.installments,
        issueDate: header.issueDate,
        freightAmount: freightValue,
        discountAmount: discountValue,
        items: cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
        })),
      };
      const order = await createSaleOrder(input);
      setConfirmedOrder(order);
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setHeader(buildHeaderInicial(defaultSeller));
    setCart([]);
    setFreight("");
    setDiscount("");
    setSubmitError(null);
    setConfirmedOrder(null);
    setLastRemoved(null);
  }

  return {
    header,
    setField,
    selectContact,
    selectSeller,
    headerValid,
    cart,
    addProduct,
    updateLine,
    removeLine,
    lineTotal,
    lastRemoved,
    undoRemove,
    freight,
    setFreight,
    discount,
    setDiscount,
    subtotal,
    freightValue,
    discountValue,
    total,
    canConfirm,
    submitting,
    submitError,
    confirmedOrder,
    confirmOrder,
    reset,
  };
}
