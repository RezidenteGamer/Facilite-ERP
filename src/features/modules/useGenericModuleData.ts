import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createGenericModuleRepository,
  type GenericRow,
} from "../../lib/repositories/genericModuleRepository";
import type { ModuleFieldDefinition } from "../registry-engine/types";

type Options = {
  table: string | null;
  fields: ModuleFieldDefinition[];
  branchId: string | null;
  branchScoped: boolean;
  /** Não busca nada enquanto for falso (ex.: sem permissão de ver). */
  enabled: boolean;
};

/**
 * Carrega e muta as linhas de um módulo servido pelo motor genérico. Espelha
 * `useProductsData`, mas sem conhecer nenhum domínio — o que ele sabe da
 * tabela vem inteiro de `modules.data_table` + `module_fields`.
 */
export function useGenericModuleData({ table, fields, branchId, branchScoped, enabled }: Options) {
  const [rows, setRows] = useState<GenericRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const repository = useMemo(
    () => (table ? createGenericModuleRepository({ table, fields, branchId, branchScoped }) : null),
    [table, fields, branchId, branchScoped],
  );

  const reload = useCallback(async () => {
    if (!repository || !enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRows(await repository.list({}));
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar os registros."));
    } finally {
      setLoading(false);
    }
  }, [repository, enabled]);

  useEffect(() => {
    reload();
  }, [reload]);

  const createRow = useCallback(
    async (values: Record<string, string>) => {
      if (!repository) throw new Error("Este módulo não tem tabela de dados configurada.");
      await repository.create(values);
      await reload();
    },
    [repository, reload],
  );

  const updateRow = useCallback(
    async (id: string, values: Record<string, string>) => {
      if (!repository) throw new Error("Este módulo não tem tabela de dados configurada.");
      await repository.update(id, values);
      await reload();
    },
    [repository, reload],
  );

  const removeRow = useCallback(
    async (id: string) => {
      if (!repository) throw new Error("Este módulo não tem tabela de dados configurada.");
      await repository.remove(id);
      await reload();
    },
    [repository, reload],
  );

  return { rows, loading, error, setError, reload, createRow, updateRow, removeRow };
}

/**
 * Erros do supabase-js (`PostgrestError`) são objetos simples, não instâncias
 * de `Error` — checar só `err instanceof Error` engole a mensagem real do
 * banco. Mesmo padrão já usado em `useSaleDraft.ts`.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}
