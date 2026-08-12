export type FinanceKind = "a-pagar" | "a-receber" | "baixados";

export type FinanceEntry = {
  id: string;
  code: string;
  client: string;
  paymentMethod: string;
  installment: string;
  total: number;
  document?: string;
  dueDate?: string;
  issueDate?: string;
  changedAt?: string;
  operator?: string;
  settledAt?: string;
};

/** Formato monetário do sistema (pt-BR, sem símbolo — a coluna já diz "Valor"). */
export function formatEntryTotal(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Dados de exemplo — sem back-end ainda. Trocar por uma busca real
 * (Supabase) quando o cadastro existir; a tela só depende deste formato.
 */
export const FINANCE_ENTRIES: Record<FinanceKind, FinanceEntry[]> = {
  "a-pagar": [
    {
      id: "pag-001",
      code: "001",
      client: "Distribuidora Alfa",
      paymentMethod: "Boleto",
      installment: "1/3",
      total: 450,
      document: "NF 001",
      dueDate: "20/08/2026",
      issueDate: "10/08/2026",
      operator: "Bruno venzo debacco",
    },
  ],
  "a-receber": [
    {
      id: "rec-001",
      code: "001",
      client: "Bruno venzo debacco",
      paymentMethod: "Cartão de crédito",
      installment: "1/3",
      total: 450,
      document: "NF 001",
      dueDate: "20/08/2026",
      issueDate: "10/08/2026",
      operator: "Bruno venzo debacco",
    },
  ],
  baixados: [],
};
