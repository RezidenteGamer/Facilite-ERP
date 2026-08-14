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

/** Monta o input de create/update de Produto a partir dos valores (texto) do RegistryFormModal. */
export function buildProductInput(values: Record<string, string>): Omit<Product, "id" | "code" | "createdAt"> {
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
  };
}
