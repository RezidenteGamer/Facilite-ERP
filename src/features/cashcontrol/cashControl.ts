export type OperationalCashRegister = {
  id: string;
  name: string;
  openedAt?: string;
  closedAt?: string;
  operator?: string;
};

export type ManagerialCashEntry = {
  id: string;
  code: string;
  client: string;
  document?: string;
  type?: string;
  settledAt?: string;
  currency?: string;
  total?: number;
};

/** Formato monetário do sistema (pt-BR, sem símbolo — a coluna já diz "Valor"). */
export function formatCashTotal(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Dados de exemplo — sem back-end ainda. Trocar por uma busca real
 * (Supabase) quando o cadastro existir; a tela só depende deste formato.
 */
export const OPERATIONAL_CASH_REGISTERS: OperationalCashRegister[] = [];

export const MANAGERIAL_CASH_ENTRIES: ManagerialCashEntry[] = [
  { id: "caixa-ger-001", code: "", client: "", total: 100000 },
];
