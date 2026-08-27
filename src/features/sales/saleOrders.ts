import type { SalePaymentMethod } from "./sales";

export type SaleOrderStatus = "aberto" | "convertido" | "cancelado";

export const SALE_ORDER_STATUS_LABEL: Record<SaleOrderStatus, string> = {
  aberto: "Aberto",
  convertido: "Convertido",
  cancelado: "Cancelado",
};

export type SaleOrderItem = {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  totalAmount: number;
};

export type SaleOrder = {
  id: string;
  branchId: string;
  code: string;
  status: SaleOrderStatus;
  contactId: string;
  contactName: string;
  sellerId: string;
  sellerName: string;
  paymentMethod: SalePaymentMethod;
  installments: number;
  address?: string;
  deliveryAddress?: string;
  operationType?: string;
  department?: string;
  costCenter?: string;
  issueDate: string;
  freightAmount: number;
  discountAmount: number;
  subtotalAmount: number;
  totalAmount: number;
  convertedSaleId?: string;
  createdAt?: string;
};

/** Formato monetário do sistema (pt-BR, com "R$" — mesmo padrão de `formatPrice` em Produtos). */
export function formatOrderTotal(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Data ISO (`yyyy-mm-dd`) no formato pt-BR, sem `Date` — evita o deslize de fuso, mesmo padrão de `formatReturnDate`. */
export function formatOrderDate(iso: string | null | undefined) {
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}
