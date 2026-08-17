import { supabase } from "../supabaseClient";
import type { Tables, TablesUpdate } from "../../types/supabase";
import {
  formatDateOnly,
  formatEntryTotal,
  formatTimestamp,
  type FinanceEntry,
  type FinanceEntryEditInput,
  type FinanceEntryPlanInput,
} from "../../features/finance/finance";

type FinancialEntryRow = Tables<"financial_entries"> & {
  contacts: { name: string } | null;
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

const SELECT_WITH_JOINS = "*, contacts(name), profiles(name)";

function toFinanceEntry(row: FinancialEntryRow): FinanceEntry {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    status: row.status,
    contactId: row.contact_id ?? undefined,
    contactName: row.contacts?.name ?? "",
    paymentMethod: row.payment_method ?? "",
    installmentNumber: row.installment_number,
    installmentTotal: row.installment_total,
    installment: `${row.installment_number}/${row.installment_total}`,
    installmentGroupId: row.installment_group_id,
    originKind: row.origin_kind,
    originId: row.origin_id ?? undefined,
    total: row.total,
    totalFormatted: formatEntryTotal(row.total),
    document: row.document ?? "",
    dueDate: row.due_date,
    dueDateFormatted: formatDateOnly(row.due_date),
    issueDate: row.issue_date,
    issueDateFormatted: formatDateOnly(row.issue_date),
    changedAt: formatTimestamp(row.updated_at),
    operatorName: row.profiles?.name ?? "",
    settledAt: row.settled_at ?? undefined,
    settledAtFormatted: formatTimestamp(row.settled_at),
  };
}

function toEditRow(patch: FinanceEntryEditInput): TablesUpdate<"financial_entries"> {
  return {
    ...(patch.contactId !== undefined && { contact_id: patch.contactId || null }),
    ...(patch.paymentMethod !== undefined && { payment_method: patch.paymentMethod || null }),
    ...(patch.total !== undefined && { total: patch.total }),
    ...(patch.document !== undefined && { document: patch.document || null }),
    ...(patch.dueDate !== undefined && { due_date: patch.dueDate }),
    ...(patch.issueDate !== undefined && { issue_date: patch.issueDate }),
  };
}

export type FinancialEntriesRepository = {
  list(): Promise<FinanceEntry[]>;
  createPlan(input: FinanceEntryPlanInput): Promise<FinanceEntry[]>;
  update(id: string, patch: FinanceEntryEditInput): Promise<FinanceEntry>;
  settle(id: string): Promise<FinanceEntry>;
  reopen(id: string): Promise<FinanceEntry>;
  remove(id: string): Promise<void>;
};

/**
 * Repositório do Financeiro para uma filial fixa. Não implementa
 * `ModuleDataRepository<T>` de propósito: criar aqui não é "um registro por
 * vez" — uma operação (compra em 3x, recebimento à vista) vira N linhas
 * ligadas por `installment_group_id`, geradas atomicamente por uma RPC
 * (`create_financial_entry_installments` -> núcleo
 * `financial_entries_create_installments`, o mesmo núcleo que `create_sale`
 * chama para gerar contas a receber de venda). `createPlan` devolve
 * `FinanceEntry[]`, não um registro só — por isso o desvio do contrato
 * genérico, análogo em espírito ao `ModuleBatchRepository` de Ajuste de
 * Estoque, mas não o mesmo: ali são N itens *independentes*; aqui são N
 * parcelas de uma *mesma* operação, que o AGENTS.md documenta à parte (ver
 * decisão da etapa de parcelamento do módulo Financeiro).
 *
 * Editar e excluir continuam sendo de registro único (uma parcela por vez),
 * por isso `update`/`remove`/`list` têm a cara do contrato genérico — só a
 * criação diverge.
 */
export function createFinancialEntriesRepository(branchId: string): FinancialEntriesRepository {
  return {
    async list() {
      const client = assertSupabase();
      const { data, error } = await client
        .from("financial_entries")
        .select(SELECT_WITH_JOINS)
        .eq("branch_id", branchId)
        .order("due_date", { ascending: true })
        .order("code", { ascending: true });
      if (error) throw error;
      return ((data as FinancialEntryRow[] | null) ?? []).map(toFinanceEntry);
    },

    async createPlan(input) {
      const client = assertSupabase();
      const { data, error } = await client.rpc("create_financial_entry_installments", {
        p_branch_id: branchId,
        p_type: input.type,
        p_contact_id: input.contactId ?? null,
        p_total: input.total,
        p_installment_count: input.installmentCount,
        p_first_due_date: input.firstDueDate,
        p_interval_days: input.intervalDays,
        p_payment_method: input.paymentMethod ?? null,
        p_document: input.document ?? null,
        p_settled: input.settled,
      });
      if (error) throw error;
      // A RPC devolve as linhas cruas de `financial_entries`, sem os joins
      // de nome (contato/operador) — quem chama recarrega a lista logo em
      // seguida, então aqui só evita devolver `undefined`.
      return ((data as Tables<"financial_entries">[] | null) ?? []).map((row) =>
        toFinanceEntry({ ...row, contacts: null, profiles: null }),
      );
    },

    async update(id, patch) {
      const client = assertSupabase();
      const { data, error } = await client
        .from("financial_entries")
        .update(toEditRow(patch))
        .eq("id", id)
        .select(SELECT_WITH_JOINS)
        .single();
      if (error) throw error;
      return toFinanceEntry(data as FinancialEntryRow);
    },

    async settle(id) {
      const client = assertSupabase();
      const { data, error } = await client
        .from("financial_entries")
        .update({ status: "baixado", settled_at: new Date().toISOString() })
        .eq("id", id)
        .select(SELECT_WITH_JOINS)
        .single();
      if (error) throw error;
      return toFinanceEntry(data as FinancialEntryRow);
    },

    /** "Excluir baixa": desfaz a baixa, o lançamento volta a `aberto`. */
    async reopen(id) {
      const client = assertSupabase();
      const { data, error } = await client
        .from("financial_entries")
        .update({ status: "aberto", settled_at: null })
        .eq("id", id)
        .select(SELECT_WITH_JOINS)
        .single();
      if (error) throw error;
      return toFinanceEntry(data as FinancialEntryRow);
    },

    async remove(id) {
      const client = assertSupabase();
      const { error } = await client.from("financial_entries").delete().eq("id", id);
      if (error) throw error;
    },
  };
}
