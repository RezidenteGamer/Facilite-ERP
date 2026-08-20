import type { SaleReturnListRow } from "../../lib/repositories/saleReturnsRepository";

export type SaleReturn = SaleReturnListRow;

/** Formato monetário do sistema (pt-BR, com "R$" — a tela mostra o símbolo). */
export function formatReturnTotal(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Data ISO (`yyyy-mm-dd`) no formato pt-BR, sem `Date` — evita o deslize de fuso de sempre. */
export function formatReturnDate(iso: string | null | undefined) {
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

/** Quantidade com até 3 casas, sem zeros à toa ("2" em vez de "2,000"). */
export function formatQuantity(value: number) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

const STATUS_LABEL: Record<SaleReturn["status"], string> = {
  confirmed: "Confirmada",
  cancelled: "Cancelada",
};

export function saleReturnStatusLabel(status: SaleReturn["status"]) {
  return STATUS_LABEL[status];
}

/**
 * Converte o texto digitado de quantidade em número.
 *
 * `null` para vazio **ou não numérico** — mesma disciplina do `parseAmount` do
 * Financeiro, e pelo mesmo motivo: um parser com fallback numérico transforma
 * `abc` em `0` em silêncio, e o operador só descobre depois de gravar.
 */
export function parseQuantity(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Prévia do valor de uma linha devolvida — **réplica da matemática da RPC**
 * `create_sale_return`, na mesma ordem e com o mesmo arredondamento.
 *
 * Mesmo precedente de `computeInstallmentPreview` no Financeiro: sem a prévia,
 * o operador só descobriria o rateio de desconto depois de confirmar. Se esta
 * conta e a da RPC divergirem, a tela mente — por isso as duas estão
 * documentadas uma na outra.
 *
 * O que entra: preço unitário herdado do item da venda, menos a fatia
 * proporcional do desconto **daquele item** e a fatia proporcional do desconto
 * do **cabeçalho** da venda. Frete não volta (o transporte já foi consumido).
 */
export function computeReturnLineTotal(input: {
  unitPrice: number;
  soldQuantity: number;
  itemDiscount: number;
  returnQuantity: number;
  saleSubtotal: number;
  saleDiscount: number;
}): number {
  const round2 = (value: number) => Math.round(value * 100) / 100;
  const gross = round2(input.unitPrice * input.returnQuantity);
  const itemDiscountShare =
    input.soldQuantity > 0 ? round2((input.itemDiscount * input.returnQuantity) / input.soldQuantity) : 0;
  const headerDiscountShare =
    input.saleDiscount > 0 && input.saleSubtotal > 0
      ? round2((input.saleDiscount * (gross - itemDiscountShare)) / input.saleSubtotal)
      : 0;
  return Math.max(gross - itemDiscountShare - headerDiscountShare, 0);
}
