import { useCallback, useEffect, useState } from "react";
import { createFinancialEntriesRepository } from "../../lib/repositories/financialEntriesRepository";
import type { FinanceEntry, FinanceEntryEditInput, FinanceEntryPlanInput } from "./finance";

/**
 * Carrega e muta os lançamentos financeiros de uma filial, com estado de
 * loading/erro. Carrega a filial inteira de uma vez — as três abas (a pagar,
 * a receber, baixados) são recortes do mesmo conjunto, feitos na página.
 */
export function useFinancialEntriesData(branchId: string | null) {
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!branchId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const repository = createFinancialEntriesRepository(branchId);
      const rows = await repository.list();
      setEntries(rows);
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar os lançamentos financeiros."));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Lança as N parcelas de uma operação numa transação só (RPC) e recarrega. */
  async function createPlan(input: FinanceEntryPlanInput) {
    if (!branchId) throw new Error("Selecione uma filial antes de lançar uma conta.");
    const repository = createFinancialEntriesRepository(branchId);
    await repository.createPlan(input);
    await reload();
  }

  /** Edita uma parcela em aberto (o banco recusa se ela já estiver baixada). */
  async function updateEntry(id: string, patch: FinanceEntryEditInput) {
    if (!branchId) throw new Error("Selecione uma filial.");
    await createFinancialEntriesRepository(branchId).update(id, patch);
    await reload();
  }

  async function settleEntry(id: string) {
    if (!branchId) throw new Error("Selecione uma filial.");
    await createFinancialEntriesRepository(branchId).settle(id);
    await reload();
  }

  async function reopenEntry(id: string) {
    if (!branchId) throw new Error("Selecione uma filial.");
    await createFinancialEntriesRepository(branchId).reopen(id);
    await reload();
  }

  async function deleteEntry(id: string) {
    if (!branchId) throw new Error("Selecione uma filial.");
    await createFinancialEntriesRepository(branchId).remove(id);
    await reload();
  }

  return { entries, loading, error, reload, createPlan, updateEntry, settleEntry, reopenEntry, deleteEntry };
}

/**
 * Erros do supabase-js (`PostgrestError`, incluindo os que vêm dos gatilhos
 * e RPCs de `financial_entries`) são objetos simples, não instâncias de
 * `Error` — checar só `instanceof Error` engoliria a mensagem real. Mesmo
 * cuidado já documentado em `useSaleDraft.ts`.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  return fallback;
}
