import { useMemo, useState } from "react";
import type { Contact } from "../customers/contacts";
import type { Product } from "../products/products";
import { createSale, type CreateSaleInput } from "../../lib/repositories/salesRepository";
import type { SalePaymentMethod, Sale } from "./sales";
import type { SaleSeller } from "../../lib/repositories/salesLookups";

export type SaleHeaderForm = {
  clienteId: string;
  clienteNome: string;
  vendedorId: string;
  vendedorNome: string;
  endereco: string;
  enderecoEntrega: string;
  tipoOperacao: string;
  departamento: string;
  centroCustos: string;
  dataEmissao: string;
  dataSaida: string;
};

const HEADER_INICIAL: SaleHeaderForm = {
  clienteId: "",
  clienteNome: "",
  vendedorId: "",
  vendedorNome: "",
  endereco: "",
  enderecoEntrega: "",
  tipoOperacao: "",
  departamento: "",
  centroCustos: "",
  dataEmissao: new Date().toISOString().slice(0, 10),
  dataSaida: "",
};

export type CartLine = {
  lineId: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
};

export type PaymentLine = {
  lineId: string;
  method: SalePaymentMethod;
  amount: number;
  installments: number;
};

function lineTotal(line: CartLine) {
  return Math.max(0, line.quantity * line.unitPrice - line.discountAmount);
}

/** Erros do supabase-js (ex.: PostgrestError da RPC) são objetos simples, não `Error`. */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  return "Erro ao confirmar a venda.";
}

/** Estado do rascunho de uma venda em andamento: cabeçalho + carrinho + pagamentos. */
export function useSaleDraft(branchId: string | null) {
  const [header, setHeader] = useState<SaleHeaderForm>(HEADER_INICIAL);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [freight, setFreight] = useState("");
  const [discount, setDiscount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedSale, setConfirmedSale] = useState<Sale | null>(null);

  function setField<K extends keyof SaleHeaderForm>(field: K, value: SaleHeaderForm[K]) {
    setHeader((current) => ({ ...current, [field]: value }));
  }

  function selectContact(contact: Contact) {
    setHeader((current) => ({
      ...current,
      clienteId: contact.id,
      clienteNome: contact.name,
      endereco: contact.address ?? current.endereco,
      enderecoEntrega: current.enderecoEntrega || contact.address || "",
    }));
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
        {
          lineId: crypto.randomUUID(),
          product,
          quantity: 1,
          unitPrice: product.salePrice,
          discountAmount: 0,
        },
      ];
    });
  }

  function updateLine(lineId: string, patch: Partial<Pick<CartLine, "quantity" | "unitPrice" | "discountAmount">>) {
    setCart((current) => current.map((line) => (line.lineId === lineId ? { ...line, ...patch } : line)));
  }

  function removeLine(lineId: string) {
    setCart((current) => current.filter((line) => line.lineId !== lineId));
  }

  function addPayment() {
    setPayments((current) => [
      ...current,
      { lineId: crypto.randomUUID(), method: "dinheiro", amount: 0, installments: 1 },
    ]);
  }

  function updatePayment(lineId: string, patch: Partial<Pick<PaymentLine, "method" | "amount" | "installments">>) {
    setPayments((current) => current.map((line) => (line.lineId === lineId ? { ...line, ...patch } : line)));
  }

  function removePayment(lineId: string) {
    setPayments((current) => current.filter((line) => line.lineId !== lineId));
  }

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + lineTotal(line), 0), [cart]);
  const freightValue = Math.max(0, Number(freight.replace(",", ".")) || 0);
  const discountValue = Math.max(0, Number(discount.replace(",", ".")) || 0);
  const total = Math.max(0, subtotal + freightValue - discountValue);
  const paymentsTotal = useMemo(() => payments.reduce((sum, p) => sum + p.amount, 0), [payments]);
  const paymentsMatch = cart.length > 0 && Math.abs(paymentsTotal - total) < 0.01;

  const canConfirm = headerValid && cart.length > 0 && payments.length > 0 && paymentsMatch && !submitting;

  async function confirmSale() {
    if (!branchId) {
      setSubmitError("Nenhuma filial selecionada.");
      return;
    }
    if (!canConfirm) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const input: CreateSaleInput = {
        branchId,
        contactId: header.clienteId,
        sellerId: header.vendedorId,
        address: header.endereco || undefined,
        deliveryAddress: header.enderecoEntrega || undefined,
        operationType: header.tipoOperacao || undefined,
        department: header.departamento || undefined,
        costCenter: header.centroCustos || undefined,
        issueDate: header.dataEmissao,
        exitDate: header.dataSaida || undefined,
        freightAmount: freightValue,
        discountAmount: discountValue,
        items: cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
        })),
        payments: payments.map((p) => ({ method: p.method, amount: p.amount, installments: p.installments })),
      };
      const sale = await createSale(input);
      setConfirmedSale(sale);
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setHeader(HEADER_INICIAL);
    setCart([]);
    setPayments([]);
    setFreight("");
    setDiscount("");
    setSubmitError(null);
    setConfirmedSale(null);
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
    payments,
    addPayment,
    updatePayment,
    removePayment,
    freight,
    setFreight,
    discount,
    setDiscount,
    subtotal,
    freightValue,
    discountValue,
    total,
    paymentsTotal,
    paymentsMatch,
    canConfirm,
    submitting,
    submitError,
    confirmedSale,
    confirmSale,
    reset,
  };
}
