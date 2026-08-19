export type Product = {
  id: string;
  code: string;
  description: string;
  stock: number;
  salePrice: number;
  active: boolean;
  taxation?: string;
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
};

/** Formato monetário do sistema (pt-BR, sem símbolo — a coluna já diz "Valor"). */
export function formatPrice(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
 * Monta o input de create/update de Produto a partir dos valores (texto) do
 * `RegistryFormModal`. O grupo tributário vem à parte porque é escolhido pelo
 * `lookupField` (um id, não um campo de texto do formulário) — mesmo formato
 * do contato no Financeiro.
 */
export function buildProductInput(
  values: Record<string, string>,
  taxGroupId: string | null,
): Omit<Product, "id" | "code" | "createdAt"> {
  return {
    description: values.description ?? "",
    stock: toNumber(values.stock),
    salePrice: toNumber(values.salePrice),
    active: true,
    taxation: values.taxation || undefined,
    type: values.type || undefined,
    costPrice: toOptionalNumber(values.costPrice),
    wholesalePrice: toOptionalNumber(values.wholesalePrice),
    ncm: values.ncm || undefined,
    location: values.location || undefined,
    subLocation: values.subLocation || undefined,
    cest: values.cest || undefined,
    origemMercadoria: values.origemMercadoria || undefined,
    unidadeComercial: values.unidadeComercial || undefined,
    unidadeTributavel: values.unidadeTributavel || undefined,
    cstIpi: values.cstIpi || undefined,
    taxGroupId,
  };
}
