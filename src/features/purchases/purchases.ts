import type { SalePaymentMethod } from "../sales/sales";

export type PurchaseStatus = "confirmed" | "cancelled";

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  confirmed: "Confirmada",
  cancelled: "Cancelada",
};

export type PurchaseItem = {
  id: string;
  productId: string;
  quantity: number;
  unitCost: number;
  totalAmount: number;
};

export type Purchase = {
  id: string;
  branchId: string;
  code: string;
  status: PurchaseStatus;
  contactId: string;
  contactName: string;
  paymentMethod: SalePaymentMethod;
  installmentTotal: number;
  document?: string;
  issueDate: string;
  entryDate: string;
  subtotalAmount: number;
  totalAmount: number;
  createdAt?: string;
};

/** Formato monetário do sistema (pt-BR, com "R$" — a tela mostra o símbolo). */
export function formatPurchaseTotal(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
