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

/** Formato monetário do sistema (pt-BR, sem símbolo — a coluna já diz "Valor total"). */
export function formatOrderTotal(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
