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

/**
 * Onde o dado físico do módulo mora — a coluna `modules.storage_kind`.
 *
 * - `table`: uma tabela real e tipada, cujo nome vem de `modules.data_table`
 *   (Tributações, Grupos tributários, e todo módulo oficial).
 * - `generic`: uma linha em `module_records`, com o corpo do registro em
 *   `data` (jsonb) — o caminho dos módulos criados pelo usuário, que não têm
 *   tabela própria porque ninguém dispara `CREATE TABLE` a partir da tela.
 */
export type ModuleStorageKind = "table" | "generic";

export type GenericModuleRepositoryOptions = {
  /** Id do módulo (`modules.id`) — é o filtro do armazenamento genérico. */
  moduleId: string;
  storageKind: ModuleStorageKind;
  /** `modules.data_table`; nulo quando o módulo é `generic`. */
  table: string | null;
  fields: ModuleFieldDefinition[];
  /** Filial ativa; só usada quando o módulo é isolado por filial. */
  branchId?: string | null;
  branchScoped: boolean;
};

/** Tabela única onde vivem os registros de todos os módulos do usuário. */
const GENERIC_TABLE = "module_records";

/**
 * Colunas reais de `module_records`, em `accessorKey`. Nenhum campo do usuário
 * pode usar uma destas chaves: o corpo do registro é espalhado sobre `{ id }`
 * na leitura, e uma chave `id` dentro do jsonb sobrescreveria o id da linha.
 * Quem recusa de verdade é `create_user_module` no banco; isto aqui é a rede
 * de proteção do lado da leitura.
 */
const RESERVED_KEYS = ["id", "moduleId", "branchId", "data", "createdAt", "updatedAt", "createdBy"];

/**
 * Situação do workflow (M4), exposta na linha lida.
 *
 * O prefixo de dois underscores não é enfeite: `field_key` é slugificada por
 * `module_field_key` (que nunca deixa underscore na ponta), então nenhum
 * campo do usuário — nem um chamado "Status" — consegue gerar esta chave e
 * disputar o lugar dela.
 */
export const STATUS_KEY = "__status";

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

/**
 * Campo opcional vazio vira `null` (não string vazia); obrigatório vazio segue
 * como está e o formulário/banco recusam — a validação de obrigatoriedade já
 * foi feita pelo `RegistryFormModal` a partir do próprio `module_fields`.
 *
 * Compartilhado pelos dois caminhos: o que muda entre eles é **onde** o valor
 * é gravado, não como ele é normalizado.
 */
function normalize(value: unknown, field: ModuleFieldDefinition): unknown {
  return value === "" && !field.isRequired ? null : value;
}

/* ------------------------------------------------------------------ *
 * Caminho 1 — tabela real e tipada (`modules.data_table`)
 * ------------------------------------------------------------------ */

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
 * colunas físicas da tabela dedicada.
 */
function toColumns(
  values: Record<string, unknown>,
  fields: ModuleFieldDefinition[],
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field.accessorKey in values)) continue;
    row[field.fieldKey] = normalize(values[field.accessorKey], field);
  }
  return row;
}

/* ------------------------------------------------------------------ *
 * Caminho 2 — armazenamento genérico (`module_records.data`, jsonb)
 * ------------------------------------------------------------------ */

/**
 * Mesma responsabilidade de `toGenericRow`, forma diferente de ler: o corpo do
 * registro está dentro de `data`, e `id` continua sendo coluna real fora do
 * jsonb (assim como `branch_id`/`created_at`, que a RLS e a filial usam).
 */
function toGenericRowFromRecord(row: Record<string, unknown>): GenericRow {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const mapped: Record<string, unknown> = { id: row.id, [STATUS_KEY]: row.status ?? null };
  for (const [key, value] of Object.entries(data)) {
    const accessor = snakeToCamel(key);
    if (RESERVED_KEYS.includes(accessor)) continue;
    mapped[accessor] = value;
  }
  return mapped as GenericRow;
}

/**
 * Mesma responsabilidade de `toColumns`, forma diferente de gravar: tudo vai
 * para dentro de um objeto só, que será o `data` da linha.
 */
function toDataObject(
  values: Record<string, unknown>,
  fields: ModuleFieldDefinition[],
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field.accessorKey in values)) continue;
    data[field.fieldKey] = normalize(values[field.accessorKey], field);
  }
  return data;
}

/* ------------------------------------------------------------------ */

/**
 * Repositório dirigido por metadados: não conhece nenhum domínio, só onde o
 * módulo guarda o dado (`modules.storage_kind`) e os campos que
 * `module_fields` descreve.
 *
 * São **dois caminhos por dentro e um contrato só por fora**
 * (`ModuleDataRepository<T>`): quem consome — `useGenericModuleData` e a
 * `GenericModulePage` — não sabe qual dos dois está ativo. O que muda entre
 * eles é a tradução `accessorKey` ↔ armazenamento físico (`toColumns`/
 * `toGenericRow` de um lado, `toDataObject`/`toGenericRowFromRecord` do
 * outro); a normalização de valor, o filtro por filial e a forma de
 * list/create/update/remove são compartilhados.
 *
 * Os módulos oficiais continuam com repositório tipado próprio
 * (`productsRepository`, `contactsRepository`), porque eles têm regra de
 * negócio de verdade (sequencial de código, conversão de preço, joins); este
 * aqui é o caminho de quem não tem nenhuma.
 *
 * A RLS continua sendo a barreira real: o cliente monta a consulta, o banco
 * decide se ela passa. No caminho genérico quem decide é a policy de
 * `module_records`, que resolve o módulo pelo `module_id` da própria linha.
 */
export function createGenericModuleRepository(
  options: GenericModuleRepositoryOptions,
): ModuleDataRepository<GenericRow, Record<string, unknown>> {
  return options.storageKind === "generic"
    ? createRecordsRepository(options)
    : createTableRepository(options);
}

function createTableRepository({
  table,
  fields,
  branchId,
  branchScoped,
}: GenericModuleRepositoryOptions): ModuleDataRepository<GenericRow, Record<string, unknown>> {
  if (!table) {
    throw new Error("Este módulo não tem tabela de dados configurada (modules.data_table).");
  }
  const dataTable = table;

  // A ordenação sai dos próprios metadados (primeira coluna da tabela), em
  // vez de um `created_at` que nem toda tabela tem.
  const orderColumn = fields.find((field) => field.showInTable)?.fieldKey ?? null;

  function from() {
    return assertSupabase().from(dataTable);
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

function createRecordsRepository({
  moduleId,
  fields,
  branchId,
  branchScoped,
}: GenericModuleRepositoryOptions): ModuleDataRepository<GenericRow, Record<string, unknown>> {
  const orderKey = fields.find((field) => field.showInTable)?.accessorKey ?? null;
  const SELECT = "id, branch_id, created_at, status, data";

  function from() {
    return assertSupabase().from(GENERIC_TABLE);
  }

  /**
   * A ordenação acontece no cliente, não no `order()` do PostgREST: a coluna
   * de ordenação é uma **chave dentro do jsonb**, e depender da sintaxe de
   * ordenação por caminho JSON amarraria o motor genérico a um detalhe da
   * versão do PostgREST. A lista de um módulo deste tipo é um cadastro
   * simples, então ordenar aqui é barato e previsível.
   */
  function sortRows(rows: GenericRow[]): GenericRow[] {
    if (!orderKey) return rows;
    return [...rows].sort((a, b) =>
      String(a[orderKey] ?? "").localeCompare(String(b[orderKey] ?? ""), "pt-BR", {
        sensitivity: "base",
      }),
    );
  }

  return {
    async list() {
      let query = from().select(SELECT).eq("module_id", moduleId);
      if (branchScoped && branchId) query = query.eq("branch_id", branchId);

      const { data, error } = await query;
      if (error) throw error;
      return sortRows(((data ?? []) as Record<string, unknown>[]).map(toGenericRowFromRecord));
    },

    async create(input) {
      const row: Record<string, unknown> = {
        module_id: moduleId,
        data: toDataObject(input, fields),
      };
      if (branchScoped) {
        if (!branchId) throw new Error("Selecione uma filial antes de criar um registro.");
        row.branch_id = branchId;
      }

      const { data, error } = await from().insert(row).select(SELECT).single();
      if (error) throw error;
      return toGenericRowFromRecord(data as Record<string, unknown>);
    },

    /**
     * `data` é uma coluna só, então gravar o patch direto apagaria toda chave
     * que não veio no formulário — inclusive as de campos removidos de
     * `module_fields`, que continuam guardadas de propósito (remover um campo
     * para de mostrar o dado, não o apaga). Por isso o update lê o `data`
     * atual e mescla, em vez de sobrescrever.
     */
    async update(id, patch) {
      const current = await from().select("data").eq("id", id).eq("module_id", moduleId).single();
      if (current.error) throw current.error;

      const merged = {
        ...((current.data as { data?: Record<string, unknown> }).data ?? {}),
        ...toDataObject(patch, fields),
      };

      const { data, error } = await from()
        .update({ data: merged })
        .eq("id", id)
        .eq("module_id", moduleId)
        .select(SELECT)
        .single();
      if (error) throw error;
      return toGenericRowFromRecord(data as Record<string, unknown>);
    },

    async remove(id) {
      const { error } = await from().delete().eq("id", id).eq("module_id", moduleId);
      if (error) throw error;
    },
  };
}
