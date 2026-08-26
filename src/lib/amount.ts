/**
 * Converte um campo de valor (texto, vírgula decimal) em número — sem
 * mascarar erro de digitação como zero. `null` = vazio ou não numérico; o
 * chamador decide se isso é erro (é sempre erro para "Valor total", mas o
 * parser em si não assume isso). Esta é a correção do bug em que "abc"
 * virava R$ 0,00 em silêncio: antes, o fallback numérico escondia o erro.
 */
export function parseAmount(value: string | undefined): number | null {
  if (!value || !value.trim()) return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Mensagem de erro pronta para um campo de valor — não numérico ou <= 0. */
export function validateAmount(value: string | undefined, label = "Valor total"): string | null {
  const amount = parseAmount(value);
  if (amount === null) return `${label} precisa ser um número válido.`;
  if (amount <= 0) return `${label} precisa ser maior que zero.`;
  return null;
}
