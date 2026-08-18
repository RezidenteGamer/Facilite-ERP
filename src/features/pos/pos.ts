/** Formato monetário do PDV (pt-BR, com "R$"). */
export function formatMoney(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PLACEHOLDER_COLORS = ["#E4B457", "#F0913C", "#5BC8E0", "#8FA6B8", "#2B2E36", "#4CAF63", "#7C6FE0", "#E8635A"];

/**
 * Sem foto de produto no cadastro (`products` não tem coluna de imagem) —
 * o bloco colorido com iniciais é só decorativo, gerado no cliente a partir
 * do nome/código do produto, nunca persistido.
 */
export function productPlaceholder(description: string, code: string): { label: string; color: string } {
  const source = description.trim() || code;
  const words = source.split(/\s+/).filter(Boolean);
  const label = ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase() || "?";
  const hash = Array.from(source).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return { label, color: PLACEHOLDER_COLORS[hash % PLACEHOLDER_COLORS.length] };
}
