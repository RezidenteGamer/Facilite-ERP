export type CashSessionStatus = "aberto" | "fechado";

export const CASH_SESSION_STATUS_LABEL: Record<CashSessionStatus, string> = {
  aberto: "Aberto",
  fechado: "Fechado",
};

/** Um caixa físico/lógico de uma filial — catálogo simples, sem UI de administração nesta etapa (ver AGENTS.md). */
export type CashRegister = {
  id: string;
  branchId: string;
  name: string;
  active: boolean;
};

/**
 * Uma sessão de caixa (abrir → fechar). `expectedAmount`/`difference` só
 * existem depois de fechada — são calculados pela RPC `close_cash_session`,
 * nunca pelo cliente.
 */
export type CashSession = {
  id: string;
  registerId: string;
  registerName: string;
  branchId: string;
  code: string;
  status: CashSessionStatus;
  openedAt: string;
  openedAtFormatted: string;
  openedByName: string;
  openingAmount: number;
  openingAmountFormatted: string;
  closedAt?: string;
  closedAtFormatted: string;
  closedByName: string;
  countedAmount?: number;
  countedAmountFormatted: string;
  expectedAmount?: number;
  expectedAmountFormatted: string;
  difference?: number;
  differenceFormatted: string;
};

export type CashMovementType = "sangria" | "suprimento";

export const CASH_MOVEMENT_TYPE_LABEL: Record<CashMovementType, string> = {
  sangria: "Sangria",
  suprimento: "Suprimento",
};

/**
 * Uma linha do extrato da aba "Caixa gerencial": sangria, suprimento ou
 * venda em dinheiro física, todas ordenadas por data. As vendas em dinheiro
 * vêm da mesma consulta que também alimenta o cálculo de fechamento (RPC
 * `close_cash_session` → `financial_entries_cash_sales_in_window`) — ver
 * decisão no AGENTS.md sobre por que ela junta `sale_payments.method` (enum)
 * em vez de comparar o texto `financial_entries.payment_method`.
 */
export type CashLedgerEntryKind = "sangria" | "suprimento" | "venda";

export type CashLedgerEntry = {
  id: string;
  kind: CashLedgerEntryKind;
  label: string;
  description: string;
  createdAt: string;
  createdAtFormatted: string;
  /** Sempre positivo — quem exibe decide o sinal pelo `kind` (só sangria é saída). */
  amount: number;
  amountFormatted: string;
};

/**
 * Formato monetário do sistema (pt-BR, com "R$"). Não há coluna "Moeda"
 * nesta tela — decisão documentada no AGENTS.md: o sistema não tem
 * multi-moeda em lugar nenhum, então a coluna do mock era só decorativa.
 */
export function formatCashTotal(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Resultado do fechamento, pro modal mostrar "bateu/sobrou/faltou" sem reinterpretar o número em outro lugar. */
export function closeOutcomeLabel(difference: number): string {
  if (difference === 0) return "Bateu certinho.";
  if (difference > 0) return `Sobrou ${formatCashTotal(difference)}.`;
  return `Faltou ${formatCashTotal(Math.abs(difference))}.`;
}
