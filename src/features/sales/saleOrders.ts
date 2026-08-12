export type SaleOrder = {
  id: string;
  code: string;
  client: string;
  paymentMethod: string;
  installments: number;
  total: number;
};

/** Formato monetário do sistema (pt-BR, sem símbolo — a coluna já diz "Valor"). */
export function formatOrderTotal(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Dados de exemplo — sem back-end ainda. Trocar por uma busca real
 * (Supabase) quando o cadastro existir; a tela só depende deste formato.
 */
export const SALE_ORDERS: SaleOrder[] = [
  {
    id: "ped-001",
    code: "001",
    client: "Bruno venzo debacco",
    paymentMethod: "Cartão de crédito",
    installments: 3,
    total: 450,
  },
];
