import { parseAmount } from "../../lib/amount";

export type Product = {
  id: string;
  code: string;
  description: string;
  stock: number;
  salePrice: number;
  active: boolean;
  type?: string;
  costPrice?: number;
  wholesalePrice?: number;
  ncm?: string;
  location?: string;
  subLocation?: string;
  cest?: string;
  origemMercadoria?: string;
  unidadeComercial?: string;
  unidadeTributavel?: string;
  cstIpi?: string;
  /**
   * Saldo mínimo desejado — nulável de propósito, ver `toOptionalNumber`.
   * Produto sem mínimo definido nunca aparece no relatório "Estoque abaixo
   * do mínimo" (etapa 11): ausência não vira 0, que dispararia todo produto
   * sem esse campo preenchido.
   */
  minimumStock?: number;
  /**
   * Três estados: `undefined`/`null` = usa o padrão da filial (caso
   * comum); `true`/`false` sobrescreve a filial nos dois sentidos. Ver
   * `stock_allows_negative` no banco e a decisão em AGENTS.md.
   */
  allowNegativeStock?: boolean | null;
  /**
   * Grupo tributário do produto (`tax_groups`) — de onde saem CST/CSOSN e
   * alíquotas na emissão. Desde a correção de 19/08/2026 é a **única** fonte
   * de tributação do produto: os CSTs que a etapa 0 tinha posto direto em
   * `products` saíram da tabela. `cstIpi` continua aqui porque o grupo não
   * tem campo de IPI (ver AGENTS.md).
   */
  taxGroupId?: string | null;
  /** Só leitura (vem de join) — o formulário grava `taxGroupId`, nunca o nome. */
  taxGroupName?: string;
  createdAt?: string;
  photoUrl?: string;
};

/**
 * Preço de Produto (pt-BR, com "R$ ") — diferente de `formatEntryTotal` do
 * Financeiro/PDV/Controle de Caixa, que é sem símbolo de propósito (rótulos
 * como "Valor"/"Total" já dizem o que é); aqui a coluna se chama "Preço", e
 * "R$ 14,90" foi pedido explicitamente para Produtos.
 */
export function formatPrice(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Campos do formulário de produto (metadados) são sempre texto — conversão manual aqui. */
export function toNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toOptionalNumber(value: string | undefined): number | undefined {
  if (!value || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Mensagem de erro para um campo de preço, ou `null` se ele está vazio (é
 * opcional — obrigatoriedade é responsabilidade do `RegistryFormModal`) ou é
 * um número válido (aceita vírgula, ver `parseAmount`). Sem isso, "14,90"
 * virava `NaN` em `toNumber`/`toOptionalNumber` e caía silenciosamente para
 * `0`/vazio — o produto era salvo com o preço errado sem avisar ninguém.
 */
function priceFieldError(value: string | undefined, label: string): string | null {
  if (!value || !value.trim()) return null;
  return parseAmount(value) === null ? `${label} precisa ser um número válido.` : null;
}

/** `validate` do `RegistryFormModal` para os formulários de Produto (novo/editar/clonar). */
export function validateProductFormValues(values: Record<string, string>): string[] {
  const errors: string[] = [];
  const salePriceError = priceFieldError(values.salePrice, "Preço venda");
  if (salePriceError) errors.push(salePriceError);
  const costPriceError = priceFieldError(values.costPrice, "Preço custo");
  if (costPriceError) errors.push(costPriceError);
  const wholesalePriceError = priceFieldError(values.wholesalePrice, "Preço Atacado");
  if (wholesalePriceError) errors.push(wholesalePriceError);
  return errors;
}

/**
 * Monta o input de create/update de Produto a partir dos valores (texto) do
 * `RegistryFormModal`. O grupo tributário vem à parte porque é escolhido pelo
 * `lookupField` (um id, não um campo de texto do formulário) — mesmo formato
 * do contato no Financeiro.
 */
/** Valores do `<select>` de três estados — texto porque o formulário genérico só lida com strings. */
export type AllowNegativeStockOption = "" | "true" | "false";

export function parseAllowNegativeStockOption(value: string): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function allowNegativeStockToOption(value: boolean | null | undefined): AllowNegativeStockOption {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}

/**
 * `unidadeComercial`/`unidadeTributavel` vêm à parte, como `taxGroupId` e
 * `allowNegativeStockOption`: desde a unidade de medida virar `<select>`
 * alimentado por `units_of_measure` (ver AGENTS.md), os dois campos saíram
 * de `module_fields.show_in_form` e não chegam mais dentro de `values`.
 */
export function buildProductInput(
  values: Record<string, string>,
  taxGroupId: string | null,
  allowNegativeStockOption: AllowNegativeStockOption,
  unidadeComercial: string,
  unidadeTributavel: string,
): Omit<Product, "id" | "code" | "createdAt"> {
  return {
    description: values.description ?? "",
    stock: toNumber(values.stock),
    salePrice: parseAmount(values.salePrice) ?? 0,
    active: true,
    type: values.type || undefined,
    costPrice: parseAmount(values.costPrice) ?? undefined,
    wholesalePrice: parseAmount(values.wholesalePrice) ?? undefined,
    ncm: values.ncm || undefined,
    location: values.location || undefined,
    subLocation: values.subLocation || undefined,
    cest: values.cest || undefined,
    origemMercadoria: values.origemMercadoria || undefined,
    unidadeComercial: unidadeComercial || undefined,
    unidadeTributavel: unidadeTributavel || undefined,
    cstIpi: values.cstIpi || undefined,
    minimumStock: toOptionalNumber(values.minimumStock),
    taxGroupId,
    allowNegativeStock: parseAllowNegativeStockOption(allowNegativeStockOption),
  };
}
