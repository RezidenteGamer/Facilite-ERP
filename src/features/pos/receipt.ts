/**
 * Ponte entre o domínio do PDV (carrinho, pagamentos) e o formato genérico
 * de recibo (`ReceiptData`, em `lib/printer/receiptEscpos.ts`) — tarefa E1,
 * 10/09/2026. `lib/printer` não sabe o que é um "carrinho" ou uma "forma de
 * pagamento do PDV"; este arquivo é o único lugar que sabe traduzir um pro
 * outro.
 *
 * ## O bug que isto existe pra fechar
 *
 * `confirmSale` em `usePosSale.ts` chama `reset()` logo depois de confirmar
 * a venda — `cart`/`method`/`splitLines`/`received` zeram **antes** da
 * emissão da NFC-e terminar. Um botão "Imprimir" (ou a impressão automática)
 * que lesse esse estado depois do reset acharia um carrinho vazio. Por isso
 * `buildPosReceiptSnapshot` recebe os dados já resolvidos como argumentos —
 * quem chama (`usePosSale.confirmSale`) monta o snapshot **antes** de
 * `reset()` rodar, não depois. `tests/unit/posReceiptSnapshot.test.ts`
 * prova isso.
 */
import { SALE_PAYMENT_METHOD_LABEL, type SalePaymentMethod } from "../sales/sales";
import type { ReceiptData, ReceiptItem, ReceiptPayment } from "../../lib/printer/receiptEscpos";
import type { PosCartLine } from "./usePosSale";

/**
 * O recibo pronto pra impressão (`receipt`) mais o que o PDV precisa saber
 * pra decidir se abre a gaveta sozinho (`hasCashPayment`) — ver a decisão de
 * gaveta automática em AGENTS.md. Fica fora de `ReceiptData` de propósito:
 * "teve pagamento em dinheiro" é uma pergunta sobre a venda do PDV, não algo
 * que o formato genérico de recibo (`lib/printer`) precisa saber existir.
 */
export type PosReceiptSnapshot = {
  receipt: ReceiptData;
  hasCashPayment: boolean;
};

type PosReceiptPayment = { method: SalePaymentMethod; amount: number; installments: number };

type BuildReceiptSnapshotInput = {
  saleCode: string;
  issuedAt: Date;
  cart: PosCartLine[];
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  payments: PosReceiptPayment[];
  /** Troco — só faz sentido pra pagamento em dinheiro único; `null` nos demais casos. */
  changeAmount: number | null;
  storeName: string;
  storeDocument: string | null;
};

function paymentLabel(payment: PosReceiptPayment): string {
  const base = SALE_PAYMENT_METHOD_LABEL[payment.method];
  return payment.method === "credito" && payment.installments > 1 ? `${base} (${payment.installments}x)` : base;
}

export function buildPosReceiptSnapshot(input: BuildReceiptSnapshotInput): PosReceiptSnapshot {
  const items: ReceiptItem[] = input.cart.map((line) => ({
    code: line.product.code,
    description: line.product.description,
    quantity: line.quantity,
    unitPrice: line.product.salePrice,
    totalPrice: line.product.salePrice * line.quantity,
  }));

  const payments: ReceiptPayment[] = input.payments.map((payment) => ({
    label: paymentLabel(payment),
    amount: payment.amount,
  }));

  return {
    receipt: {
      storeName: input.storeName,
      storeDocument: input.storeDocument,
      saleCode: input.saleCode,
      issuedAt: input.issuedAt,
      items,
      subtotalAmount: input.subtotalAmount,
      discountAmount: input.discountAmount,
      totalAmount: input.totalAmount,
      payments,
      changeAmount: input.changeAmount,
    },
    hasCashPayment: input.payments.some((payment) => payment.method === "dinheiro"),
  };
}
