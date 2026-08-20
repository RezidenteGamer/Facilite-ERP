import type { ConditionalListRow, ConditionalStatus } from "../../lib/repositories/conditionalsRepository";

export type Conditional = ConditionalListRow;
export type { ConditionalStatus };

/** Formato monetário do sistema (pt-BR, com "R$" — mesma convenção de Devolução de venda). */
export function formatConditionalTotal(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Data ISO (`yyyy-mm-dd`) no formato pt-BR, sem `Date` — evita o deslize de fuso de sempre. */
export function formatConditionalDate(iso: string | null | undefined) {
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

/** Quantidade com até 3 casas, sem zeros à toa ("2" em vez de "2,000"). */
export function formatConditionalQuantity(value: number) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/**
 * Converte o texto digitado de quantidade em número. `null` para vazio **ou
 * não numérico** — mesma disciplina do `parseQuantity` de Devolução de venda:
 * um parser com fallback numérico transforma "abc" em 0 em silêncio.
 */
export function parseConditionalQuantity(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Cor da coluna "Status" — mesmo padrão de patch de `render` já usado no Financeiro. */
export function conditionalStatusColor(status: ConditionalStatus): string | undefined {
  if (status === "Vencida" || status === "Cancelada") return "var(--danger)";
  if (status === "Convertida em venda") return "var(--positive)";
  return undefined;
}
