export type Invoice = {
  id: string;
  code: string;
  client: string;
  model: string;
  paymentMethod: string;
  installments: number;
  total: number;
};

/** Formato monetário do sistema (pt-BR, sem símbolo — a coluna já diz "Valor"). */
export function formatInvoiceTotal(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Dados de exemplo — sem back-end ainda. Trocar por uma busca real
 * (Supabase) quando o cadastro existir; a tela só depende deste formato.
 */
export const INVOICES: Invoice[] = [
  {
    id: "nf-001",
    code: "001",
    client: "Bruno venzo debacco",
    model: "NF-e",
    paymentMethod: "Cartão de crédito",
    installments: 3,
    total: 450,
  },
];
