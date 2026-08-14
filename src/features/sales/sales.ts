export type SalePaymentMethod = "dinheiro" | "debito" | "credito" | "pix" | "boleto" | "outro";

export const SALE_PAYMENT_METHOD_LABEL: Record<SalePaymentMethod, string> = {
  dinheiro: "Dinheiro",
  debito: "Débito",
  credito: "Crédito",
  pix: "PIX",
  boleto: "Boleto",
  outro: "Outro",
};

export type SaleItem = {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  totalAmount: number;
};

export type SalePayment = {
  id: string;
  method: SalePaymentMethod;
  amount: number;
  installments: number;
};

export type Sale = {
  id: string;
  branchId: string;
  code: string;
  status: "confirmed" | "cancelled";
  contactId: string;
  sellerId: string;
  address?: string;
  deliveryAddress?: string;
  operationType?: string;
  department?: string;
  costCenter?: string;
  issueDate: string;
  exitDate?: string;
  freightAmount: number;
  discountAmount: number;
  subtotalAmount: number;
  totalAmount: number;
  createdAt?: string;
  confirmedAt?: string;
};

/** Formato monetário do sistema (pt-BR, com símbolo — usado em totais/carrinho). */
export function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
