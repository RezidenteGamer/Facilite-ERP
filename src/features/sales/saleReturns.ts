export type SaleReturn = {
  id: string;
  code: string;
  client: string;
  type: string;
  paymentMethod: string;
  total: number;
  operator: string;
  saleDate?: string;
  billingDate?: string;
  documentNumber?: string;
  movement?: string;
  installments?: string;
};

/** Formato monetário do sistema (pt-BR, com "R$" — a tela mostra o símbolo). */
export function formatReturnTotal(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Dados de exemplo — sem back-end ainda. Trocar por uma busca real
 * (Supabase) quando o cadastro existir; a tela só depende deste formato.
 */
export const SALE_RETURNS: SaleReturn[] = [
  {
    id: "devolucao-001",
    code: "",
    client: "Bruno venzo debacco",
    type: "",
    paymentMethod: "",
    total: 100000,
    operator: "",
  },
];
