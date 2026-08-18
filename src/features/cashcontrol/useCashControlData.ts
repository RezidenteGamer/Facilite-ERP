import { useCallback, useEffect, useState } from "react";
import {
  closeCashSession,
  listCashRegisters,
  listCashSessionLedger,
  listCashSessions,
  openCashSession,
  registerCashMovement,
} from "../../lib/repositories/cashControlRepository";
import { extractErrorMessage } from "../finance/useFinancialEntriesData";
import type { CashLedgerEntry, CashMovementType, CashRegister, CashSession } from "./cashControl";

/** Caixas + sessões de uma filial (aba "Caixas operacionais"), com as ações de escrita. */
export function useCashControlData(branchId: string | null) {
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!branchId) {
      setRegisters([]);
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [registersRows, sessionsRows] = await Promise.all([
        listCashRegisters(branchId),
        listCashSessions(branchId),
      ]);
      setRegisters(registersRows);
      setSessions(sessionsRows);
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar o controle de caixa."));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function openSession(input: { registerId: string; openingAmount: number }) {
    await openCashSession(input);
    await reload();
  }

  /** Devolve a sessão fechada (com esperado/contado/diferença) para o modal mostrar o resultado. */
  async function closeSession(input: { sessionId: string; countedAmount: number }): Promise<CashSession> {
    const closed = await closeCashSession(input);
    await reload();
    return closed;
  }

  async function addMovement(input: { sessionId: string; type: CashMovementType; amount: number; description: string }) {
    await registerCashMovement(input);
  }

  return { registers, sessions, loading, error, reload, openSession, closeSession, addMovement };
}

/** Extrato de uma sessão (aba "Caixa gerencial") — carregado à parte, por sessão. */
export function useCashSessionLedger(sessionId: string | null) {
  const [entries, setEntries] = useState<CashLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!sessionId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await listCashSessionLedger(sessionId);
      setEntries(rows);
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar o extrato do caixa."));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { entries, loading, error, reload };
}
