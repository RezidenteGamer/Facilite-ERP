/**
 * Normaliza texto para comparação de busca: minúsculas + sem acento (mesma
 * técnica de `previewFieldKey` em `moduleBuilder.ts`), para que "Oleo" seja
 * encontrado buscando "óleo".
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
