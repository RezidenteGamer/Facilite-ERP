import { formatTimestamp } from "../../features/finance/finance";
import {
  CASH_MOVEMENT_TYPE_LABEL,
  formatCashTotal,
  type CashLedgerEntry,
  type CashMovementType,
  type CashRegister,
  type CashSession,
} from "../../features/cashcontrol/cashControl";
import { supabase } from "../supabaseClient";
import type { Tables } from "../../types/supabase";

type CashSessionRow = Tables<"cash_sessions"> & {
  cash_registers: { name: string } | null;
  opened_by_profile: { name: string } | null;
  closed_by_profile: { name: string } | null;
};

type CashMovementRow = Tables<"cash_movements"> & {
  profiles: { name: string } | null;
};

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

function toCashRegister(row: Tables<"cash_registers">): CashRegister {
  return { id: row.id, branchId: row.branch_id, name: row.name, active: row.active };
}

function toCashSession(row: CashSessionRow): CashSession {
  return {
    id: row.id,
    registerId: row.register_id,
    registerName: row.cash_registers?.name ?? "",
    branchId: row.branch_id,
    code: row.code,
    status: row.status,
    openedAt: row.opened_at,
    openedAtFormatted: formatTimestamp(row.opened_at),
    openedByName: row.opened_by_profile?.name ?? "",
    openingAmount: row.opening_amount,
    openingAmountFormatted: formatCashTotal(row.opening_amount),
    closedAt: row.closed_at ?? undefined,
    closedAtFormatted: formatTimestamp(row.closed_at),
    closedByName: row.closed_by_profile?.name ?? "",
    countedAmount: row.counted_amount ?? undefined,
    countedAmountFormatted: row.counted_amount != null ? formatCashTotal(row.counted_amount) : "",
    expectedAmount: row.expected_amount ?? undefined,
    expectedAmountFormatted: row.expected_amount != null ? formatCashTotal(row.expected_amount) : "",
    difference: row.difference ?? undefined,
    differenceFormatted: row.difference != null ? formatCashTotal(row.difference) : "",
  };
}

const SESSION_SELECT_WITH_JOINS =
  "*, cash_registers(name), opened_by_profile:profiles!cash_sessions_opened_by_fkey(name), closed_by_profile:profiles!cash_sessions_closed_by_fkey(name)";

/** Lista os caixas cadastrados de uma filial. */
export async function listCashRegisters(branchId: string): Promise<CashRegister[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("cash_registers")
    .select("*")
    .eq("branch_id", branchId)
    .eq("active", true)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toCashRegister);
}

/** Lista as sessões de caixa de uma filial (aba "Caixas operacionais"), mais recente primeiro. */
export async function listCashSessions(branchId: string): Promise<CashSession[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("cash_sessions")
    .select(SESSION_SELECT_WITH_JOINS)
    .eq("branch_id", branchId)
    .order("opened_at", { ascending: false });
  if (error) throw error;
  return ((data as CashSessionRow[] | null) ?? []).map(toCashSession);
}

/**
 * Sessão `aberto` da filial, ou `null` — usada pelo PDV para bloquear a venda
 * na tela antes mesmo de chamar `create_pos_sale` (que recusa a mesma
 * situação no banco; esta consulta é só para a UX de avisar antes).
 */
export async function getOpenCashSession(branchId: string): Promise<CashSession | null> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("cash_sessions")
    .select(SESSION_SELECT_WITH_JOINS)
    .eq("branch_id", branchId)
    .eq("status", "aberto")
    .maybeSingle();
  if (error) throw error;
  return data ? toCashSession(data as CashSessionRow) : null;
}

/** Abre uma sessão nova (RPC valida permissão, filial e que não há outra sessão aberta na filial). */
export async function openCashSession(input: { registerId: string; openingAmount: number }): Promise<void> {
  const client = assertSupabase();
  const { error } = await client.rpc("open_cash_session", {
    p_register_id: input.registerId,
    p_opening_amount: input.openingAmount,
  });
  if (error) throw error;
}

/** Fecha a sessão informando o valor contado — devolve a sessão já com esperado/diferença calculados. */
export async function closeCashSession(input: {
  sessionId: string;
  countedAmount: number;
}): Promise<CashSession> {
  const client = assertSupabase();
  const { data, error } = await client.rpc("close_cash_session", {
    p_session_id: input.sessionId,
    p_counted_amount: input.countedAmount,
  });
  if (error) throw error;
  return toCashSession({ ...(data as Tables<"cash_sessions">), cash_registers: null, opened_by_profile: null, closed_by_profile: null });
}

/** Lança sangria/suprimento numa sessão aberta. */
export async function registerCashMovement(input: {
  sessionId: string;
  type: CashMovementType;
  amount: number;
  description: string;
}): Promise<void> {
  const client = assertSupabase();
  const { error } = await client.rpc("register_cash_movement", {
    p_session_id: input.sessionId,
    p_type: input.type,
    p_amount: input.amount,
    p_description: input.description,
  });
  if (error) throw error;
}

/**
 * Extrato de uma sessão: sangrias/suprimentos (leitura direta, RLS cuida do
 * acesso) + vendas em dinheiro da sessão (RPC de leitura
 * `list_cash_session_cash_sales`, que junta financial_entries → sales →
 * sale_payments pelo enum `method`, não por texto — ver AGENTS.md). Mesma
 * consulta que a RPC `close_cash_session` usa para calcular o esperado, por
 * isso o extrato e o fechamento nunca divergem.
 */
export async function listCashSessionLedger(sessionId: string): Promise<CashLedgerEntry[]> {
  const client = assertSupabase();

  const [movementsResult, cashSalesResult] = await Promise.all([
    client
      .from("cash_movements")
      .select("*, profiles(name)")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
    client.rpc("list_cash_session_cash_sales", { p_session_id: sessionId }),
  ]);

  if (movementsResult.error) throw movementsResult.error;
  if (cashSalesResult.error) throw cashSalesResult.error;

  const movementEntries: CashLedgerEntry[] = ((movementsResult.data as CashMovementRow[] | null) ?? []).map(
    (row) => ({
      id: row.id,
      kind: row.type,
      label: CASH_MOVEMENT_TYPE_LABEL[row.type],
      description: row.description,
      createdAt: row.created_at,
      createdAtFormatted: formatTimestamp(row.created_at),
      amount: row.amount,
      amountFormatted: formatCashTotal(row.amount),
    }),
  );

  const cashSaleEntries: CashLedgerEntry[] = ((cashSalesResult.data as Tables<"financial_entries">[] | null) ?? []).map(
    (row) => ({
      id: row.id,
      kind: "venda" as const,
      label: "Venda",
      description: row.document ?? "",
      createdAt: row.created_at,
      createdAtFormatted: formatTimestamp(row.created_at),
      amount: row.total,
      amountFormatted: formatCashTotal(row.total),
    }),
  );

  return [...movementEntries, ...cashSaleEntries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
