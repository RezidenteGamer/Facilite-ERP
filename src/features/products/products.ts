export type Product = {
  id: string;
  code: string;
  description: string;
  stock: number;
  salePrice: number;
  active: boolean;
  taxation?: string;
  type?: string;
  costPrice?: string;
  wholesalePrice?: string;
  ncm?: string;
  location?: string;
  subLocation?: string;
  createdAt?: string;
  operator?: string;
};

/** Formato monetário do sistema (pt-BR, sem símbolo — a coluna já diz "Valor"). */
export function formatPrice(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Dados de exemplo — sem back-end ainda. Trocar por uma busca real
 * (Supabase) quando o cadastro existir; a tela só depende deste formato.
 */
export const PRODUCTS: Product[] = [
  {
    id: "prod-001",
    code: "",
    description: "Doritos 120g pizza",
    stock: 150,
    salePrice: 15,
    active: true,
  },
];
