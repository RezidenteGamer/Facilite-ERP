import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import type { ModuleFieldDefinition } from "../../features/registry-engine/types";
import type { ModuleDataRepository } from "./types";

/**
 * Linha de um módulo servido pelo motor genérico. As chaves são os
 * `accessorKey` (camelCase) dos `module_fields`, mais `id` — exatamente o que
 * `buildTableColumns`/`buildDetailFields` já sabem ler.
 */
export type GenericRow = Record<string, unknown> & { id: string };

export type GenericModuleRepositoryOptions = {
  /** `modules.data_table` — a tabela que este módulo lê e grava. */
  table: string;
  fields: ModuleFieldDefinition[];
  /** Filial ativa; só usada quando o módulo é isolado por filial. */
  branchId?: string | null;
  branchScoped: boolean;
};

/**
 * O nome da tabela só existe em tempo de execução (vem de
 * `modules.data_table`), então o cliente tipado por `Database` não serve
 * aqui: os tipos gerados só aceitam nomes de tabela conhecidos em tempo de
 * compilação. Este é o único lugar do projeto que abre mão da tipagem — é o
 * preço de um módulo poder existir sem código escrito para ele, e está
 * confinado a este arquivo. Quem garante a forma dos dados é `module_fields`,
 * e quem garante o acesso é a RLS.
 */
function assertSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase as unknown as SupabaseClient;
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** Converte a linha crua do Postgres (snake_case) no formato que a engine lê. */
function toGenericRow(row: Record<string, unknown>): GenericRow {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    mapped[snakeToCamel(key)] = value;
  }
  return mapped as GenericRow;
}

/**
 * Traduz os valores do formulário (`accessorKey` → texto) de volta para as
 * colunas físicas. Campo opcional vazio vira `null`; obrigatório vazio segue
 * como string vazia e o banco recusa — a validação de obrigatoriedade já foi
 * feita pelo `RegistryFormModal` a partir do próprio `module_fields`.
 */
function toColumns(
  values: Record<string, unknown>,
  fields: ModuleFieldDefinition[],
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field.accessorKey in values)) continue;
    const value = values[field.accessorKey];
    row[field.fieldKey] = value === "" && !field.isRequired ? null : value;
  }
  return row;
}

/**
 * Repositório dirigido por metadados: não conhece nenhum domínio, só a tabela
 * que `modules.data_table` aponta e os campos que `module_fields` descreve.
 *
 * É o que permite um módulo existir **sem uma linha de código escrita para
 * ele** — a peça que M3 (módulos criados pelo usuário) depende. Os módulos
 * oficiais continuam com repositório tipado próprio (`productsRepository`,
 * `contactsRepository`), porque eles têm regra de negócio de verdade
 * (sequencial de código, conversão de preço, joins); este aqui é o caminho de
 * quem não tem nenhuma.
 *
 * A RLS continua sendo a barreira real: o cliente monta a consulta, o banco
 * decide se ela passa.
 */
export function createGenericModuleRepository({
  table,
  fields,
  branchId,
  branchScoped,
}: GenericModuleRepositoryOptions): ModuleDataRepository<GenericRow, Record<string, unknown>> {
  // A ordenação sai dos próprios metadados (primeira coluna da tabela), em
  // vez de um `created_at` que nem toda tabela tem.
  const orderColumn = fields.find((field) => field.showInTable)?.fieldKey ?? null;

  function from() {
    return assertSupabase().from(table);
  }

  return {
    async list() {
      let query = from().select("*");
      if (branchScoped && branchId) query = query.eq("branch_id", branchId);
      if (orderColumn) query = query.order(orderColumn, { ascending: true });

      const { data, error } = await query;
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(toGenericRow);
    },

    async create(input) {
      const row = toColumns(input, fields);
      if (branchScoped) {
        if (!branchId) throw new Error("Selecione uma filial antes de criar um registro.");
        row.branch_id = branchId;
      }

      const { data, error } = await from().insert(row).select().single();
      if (error) throw error;
      return toGenericRow(data as Record<string, unknown>);
    },

    async update(id, patch) {
      const { data, error } = await from()
        .update(toColumns(patch, fields))
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return toGenericRow(data as Record<string, unknown>);
    },

    async remove(id) {
      const { error } = await from().delete().eq("id", id);
      if (error) throw error;
    },
  };
}
