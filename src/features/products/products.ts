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
