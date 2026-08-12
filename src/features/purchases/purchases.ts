export type Purchase = {
  id: string;
  code: string;
  supplier: string;
  installments: string;
  paymentMethod: string;
  total: number;
  operator: string;
  purchaseDate?: string;
  billingDate?: string;
  documentNumber?: string;
  movement?: string;
};

/** Formato monetário do sistema (pt-BR, com "R$" — a tela mostra o símbolo). */
export function formatPurchaseTotal(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Dados de exemplo — sem back-end ainda. Trocar por uma busca real
 * (Supabase) quando o cadastro existir; a tela só depende deste formato.
 */
export const PURCHASES: Purchase[] = [
  {
    id: "compra-001",
    code: "",
    supplier: "Bruno venzo debacco",
    installments: "",
    paymentMethod: "",
    total: 100000,
    operator: "",
  },
];
