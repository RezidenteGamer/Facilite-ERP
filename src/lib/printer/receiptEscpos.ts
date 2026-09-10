/**
 * Recibo → bytes ESC/POS. Núcleo puro (sem `navigator`, sem hardware) —
 * tarefa E1, 10/09/2026. Quem chama isto não precisa saber nada de PDV: só
 * entrega `ReceiptData` já resolvido (itens, pagamentos, totais) e recebe um
 * `Uint8Array` pronto para escrever na porta da impressora
 * (`printerPort.ts`).
 *
 * **Sem QR Code e sem chave de acesso fiscal neste cupom — decisão
 * documentada em AGENTS.md.** Resumo: o cupom imprime no instante em que a
 * venda é confirmada (ver `usePosSale.ts`/`PosPage.tsx`), e a emissão da
 * NFC-e é assíncrona e roda **depois** disso (`fiscalDocument.ts`) — a chave
 * de acesso simplesmente não existe ainda no momento em que o papel precisa
 * sair. Atrasar a impressão até a nota terminar contradiria o motivo de
 * existir de uma impressora térmica (entregar o cupom na hora).
 */
import { INITIALIZE, PARTIAL_CUT, bold, concatBytes, drawerPulse, feedLines, justify } from "./escposCommands";
import type { Justification } from "./escposCommands";
import { RECEIPT_WIDTH, centerText, formatReceiptMoney, padColumns, ruleLine, wrapText } from "./receiptFormat";

export type ReceiptItem = {
  /** Código do produto (`products.code`) — impresso junto da descrição. */
  code: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

export type ReceiptPayment = {
  /** Já em português, pronto pra imprimir (ex.: "Crédito (3x)") — ver `receiptSnapshot.ts`. */
  label: string;
  amount: number;
};

export type ReceiptData = {
  storeName: string;
  storeDocument: string | null;
  /** `sales.code` — o número que identifica a venda no sistema. */
  saleCode: string;
  issuedAt: Date;
  items: ReceiptItem[];
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  payments: ReceiptPayment[];
  /** Troco — só existe em venda em dinheiro; omitido quando `null`. */
  changeAmount: number | null;
};

/**
 * Um trecho do cupom com o mesmo alinhamento/negrito do início ao fim —
 * a única representação do layout: `buildReceiptLines` (texto puro, pra
 * teste e depuração) e `buildReceiptBytes` (bytes ESC/POS de verdade) são as
 * duas só um `.map`/`.flatMap` sobre a mesma lista de blocos, pra não existir
 * dois lugares com a regra de layout que podem divergir.
 */
type ReceiptBlock = { justify: Justification; bold: boolean; lines: string[] };

function formatIssuedAt(date: Date): string {
  const dateText = date.toLocaleDateString("pt-BR");
  const timeText = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${dateText} ${timeText}`;
}

function buildReceiptBlocks(data: ReceiptData, width: number): ReceiptBlock[] {
  const blocks: ReceiptBlock[] = [];

  blocks.push({ justify: "center", bold: true, lines: [centerText(data.storeName, width)] });

  const headerRest: string[] = [];
  if (data.storeDocument) headerRest.push(centerText(`CNPJ: ${data.storeDocument}`, width));
  headerRest.push(ruleLine("=", width));
  blocks.push({ justify: "center", bold: false, lines: headerRest });

  blocks.push({
    justify: "left",
    bold: false,
    lines: [padColumns(`Venda #${data.saleCode}`, formatIssuedAt(data.issuedAt), width), ruleLine("-", width)],
  });

  const itemLines: string[] = [];
  for (const item of data.items) {
    itemLines.push(...wrapText(`${item.quantity}x ${item.description}`, width));
    itemLines.push(
      padColumns(`  ${formatReceiptMoney(item.unitPrice)} un.`, formatReceiptMoney(item.totalPrice), width),
    );
  }
  blocks.push({ justify: "left", bold: false, lines: itemLines });

  const totalsLines = [ruleLine("-", width), padColumns("Subtotal", formatReceiptMoney(data.subtotalAmount), width)];
  if (data.discountAmount > 0) {
    totalsLines.push(padColumns("Desconto", `-${formatReceiptMoney(data.discountAmount)}`, width));
  }
  blocks.push({ justify: "left", bold: false, lines: totalsLines });

  blocks.push({
    justify: "left",
    bold: true,
    lines: [padColumns("TOTAL", formatReceiptMoney(data.totalAmount), width)],
  });

  const paymentLines = [ruleLine("-", width)];
  for (const payment of data.payments) {
    paymentLines.push(padColumns(payment.label, formatReceiptMoney(payment.amount), width));
  }
  if (data.changeAmount !== null && data.changeAmount > 0) {
    paymentLines.push(padColumns("Troco", formatReceiptMoney(data.changeAmount), width));
  }
  blocks.push({ justify: "left", bold: false, lines: paymentLines });

  blocks.push({
    justify: "center",
    bold: false,
    lines: [ruleLine("=", width), centerText("Obrigado pela preferencia!", width)],
  });

  return blocks;
}

/** Corpo textual do cupom, sem os comandos ESC/POS — para teste e depuração do layout. */
export function buildReceiptLines(data: ReceiptData, width = RECEIPT_WIDTH): string[] {
  return buildReceiptBlocks(data, width).flatMap((block) => block.lines);
}

function textLine(text: string): Uint8Array {
  // Já passou por `stripToPrintableAscii` dentro de `receiptFormat.ts` — todo
  // char cabe num byte (code point < 0x80), então `charCodeAt` é seguro.
  const bytes = new Uint8Array(text.length + 1);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  bytes[text.length] = 0x0a;
  return bytes;
}

/** Monta o recibo inteiro pronto pra escrever na porta da impressora. */
export function buildReceiptBytes(data: ReceiptData, width = RECEIPT_WIDTH): Uint8Array {
  const blockBytes = buildReceiptBlocks(data, width).flatMap((block) => [
    justify(block.justify),
    bold(block.bold),
    ...block.lines.map(textLine),
  ]);

  return concatBytes([INITIALIZE, ...blockBytes, bold(false), feedLines(4), PARTIAL_CUT]);
}

/** Bytes do pulso de abertura de gaveta — mesmo canal do cupom (E2). */
export function buildDrawerPulseBytes(): Uint8Array {
  return drawerPulse(0);
}
