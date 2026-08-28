import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabaseClient";
import type { ModuleFieldDefinition } from "../registry-engine/types";
import { extractErrorMessage } from "./useGenericModuleData";

/**
 * `secondary` é o segundo campo `show_in_table` do módulo referenciado
 * (quando existe) — ex.: a descrição do CFOP, o nome da UF. `label` continua
 * curto (o primeiro campo, geralmente um código) porque é o que aparece na
 * tabela/ficha de quem referencia; `secondary` só existe para dar contexto
 * na busca (`ReferenceField`, `RegistryFormModal.tsx`) — sem ele, escolher
 * entre 601 CFOPs vira decorar código.
 */
export type ReferenceOption = { value: string; label: string; secondary?: string };

type ModuleMeta = { storageKind: "table" | "generic"; dataTable: string | null };

/**
 * Opções dos campos de referência de um módulo — os que têm
 * `module_fields.reference_module_id` preenchido. `module_fields_guard_reference`
 * (banco) exige que os dois lados tenham o mesmo `storage_kind`, então basta
 * olhar o do módulo referenciado para saber onde buscar as opções:
 *
 * - `generic`: linhas de `module_records` (`data` jsonb) — o caminho original,
 *   M4.
 * - `table`: linhas da tabela dedicada (`modules.data_table`) — os catálogos
 *   pequenos (`ufs`, `cfop`, `tipos-cliente`, `regimes-tributarios`) que
 *   Tributações passou a referenciar.
 *
 * Sem isto o campo seria um `<input>` de texto pedindo que alguém colasse um
 * uuid à mão, e a tabela mostraria o uuid de volta. O rótulo de cada opção é
 * o primeiro campo que aparece na tabela do módulo referenciado — tudo sai de
 * metadados, os dois caminhos.
 *
 * Quem decide o que entra na lista continua sendo a RLS (de `module_records`
 * ou da tabela dedicada, conforme o caso): quem não pode ver o módulo
 * referenciado recebe uma lista vazia.
 */
export function useModuleReferences(fields: ModuleFieldDefinition[], enabled: boolean) {
  const [byAccessor, setByAccessor] = useState<Record<string, ReferenceOption[]>>({});
  const [error, setError] = useState<string | null>(null);

  /* String estável para a dependência do efeito: o array de campos é
     recriado a cada render de quem chama, e comparar por identidade
     recarregaria as opções sem parar. */
  const signature = useMemo(
    () =>
      fields
        .filter((field) => field.referenceModuleId)
        .map((field) => `${field.accessorKey}:${field.referenceModuleId}`)
        .sort()
        .join("|"),
    [fields],
  );

  const load = useCallback(async () => {
    if (!enabled || !supabase || !signature) {
      setByAccessor({});
      return;
    }
    const client = supabase;

    const pairs = signature.split("|").map((entry) => {
      const [accessorKey, moduleId] = entry.split(":");
      return { accessorKey, moduleId };
    });
    const moduleIds = [...new Set(pairs.map((pair) => pair.moduleId))];

    try {
      const modulesResult = await client
        .from("modules")
        .select("id, storage_kind, data_table")
        .in("id", moduleIds);
      if (modulesResult.error) throw modulesResult.error;

      const moduleMeta = new Map<string, ModuleMeta>(
        (modulesResult.data ?? []).map((row) => [
          row.id,
          { storageKind: row.storage_kind === "generic" ? "generic" : "table", dataTable: row.data_table },
        ]),
      );

      const perModule: Record<string, ReferenceOption[]> = {};

      for (const moduleId of moduleIds) {
        const meta = moduleMeta.get(moduleId);
        perModule[moduleId] =
          meta?.storageKind === "table"
            ? await loadTableOptions(client, moduleId, meta.dataTable)
            : await loadGenericOptions(client, moduleId);
      }

      const map: Record<string, ReferenceOption[]> = {};
      for (const pair of pairs) map[pair.accessorKey] = perModule[pair.moduleId] ?? [];
      setByAccessor(map);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar os registros relacionados."));
    }
  }, [signature, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  /** uuid gravado → rótulo legível, para a tabela e a ficha. */
  const labels = useMemo(() => {
    const map: Record<string, Record<string, string>> = {};
    for (const [accessorKey, options] of Object.entries(byAccessor)) {
      map[accessorKey] = Object.fromEntries(options.map((option) => [option.value, option.label]));
    }
    return map;
  }, [byAccessor]);

  return { options: byAccessor, labels, error, reload: load };
}

function sortByLabel(options: ReferenceOption[]): ReferenceOption[] {
  return [...options].sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }));
}

async function loadGenericOptions(
  client: SupabaseClient,
  moduleId: string,
): Promise<ReferenceOption[]> {
  const [fieldsResult, recordsResult] = await Promise.all([
    client
      .from("module_fields")
      .select("field_key, show_in_table, sort_order")
      .eq("module_id", moduleId)
      .order("sort_order", { ascending: true }),
    client.from("module_records").select("id, data").eq("module_id", moduleId),
  ]);

  if (fieldsResult.error) throw fieldsResult.error;
  if (recordsResult.error) throw recordsResult.error;

  const shown = fieldsResult.data?.filter((field) => field.show_in_table) ?? [];
  const labelKey = shown[0]?.field_key ?? fieldsResult.data?.[0]?.field_key ?? null;
  const secondaryKey = shown[1]?.field_key ?? null;

  return sortByLabel(
    (recordsResult.data ?? []).map((row) => {
      const data = (row.data ?? {}) as Record<string, unknown>;
      const raw = labelKey ? data[labelKey] : null;
      const label = raw === null || raw === undefined || raw === "" ? row.id : String(raw);
      const rawSecondary = secondaryKey ? data[secondaryKey] : null;
      const secondary =
        rawSecondary === null || rawSecondary === undefined || rawSecondary === "" ? undefined : String(rawSecondary);
      return { value: row.id, label, secondary };
    }),
  );
}

/**
 * Mesma resolução de `loadGenericOptions`, para um módulo `table`: o rótulo
 * ainda sai do primeiro `module_fields.show_in_table`, mas as linhas vêm da
 * tabela física (`data_table`), não de `module_records`. O nome da tabela só
 * existe em tempo de execução, então o cliente tipado por `Database` não
 * serve aqui — mesma renúncia de tipagem que `genericModuleRepository.ts` já
 * faz pelo mesmo motivo, e confinada do mesmo jeito a esta função.
 */
async function loadTableOptions(
  client: SupabaseClient,
  moduleId: string,
  dataTable: string | null,
): Promise<ReferenceOption[]> {
  if (!dataTable) return [];

  const fieldsResult = await client
    .from("module_fields")
    .select("field_key, show_in_table, sort_order")
    .eq("module_id", moduleId)
    .order("sort_order", { ascending: true });
  if (fieldsResult.error) throw fieldsResult.error;

  const shown = fieldsResult.data?.filter((field) => field.show_in_table) ?? [];
  const labelKey = shown[0]?.field_key ?? fieldsResult.data?.[0]?.field_key ?? null;
  const secondaryKey = shown[1]?.field_key ?? null;
  const columns = [labelKey, secondaryKey].filter((key): key is string => Boolean(key));

  /* `select` como `string` solto (não um literal de template) de propósito:
     um literal faria o parser de tipos do PostgREST tentar validar a lista de
     colunas em tempo de compilação e falhar (ParserError), já que `dataTable`
     não é uma tabela conhecida do `Database` gerado — mesma renúncia de
     tipagem de `genericModuleRepository.ts`, só que também no `select`. */
  const dynamicClient = client as unknown as SupabaseClient;
  const select: string = columns.length > 0 ? `id, ${columns.join(", ")}` : "id";
  /* `.select()` tipado tenta interpretar a string em tempo de compilação
     mesmo com a tabela desconhecida, e falha (`GenericStringError`) para
     qualquer coisa além de "*" — daí o `as any` extra aqui, só nesta chamada. */
  const rowsResult = await (dynamicClient.from(dataTable) as any).select(select);
  if (rowsResult.error) throw rowsResult.error;

  return sortByLabel(
    ((rowsResult.data ?? []) as Record<string, unknown>[]).map((row) => {
      const raw = labelKey ? row[labelKey] : null;
      const value = String(row.id);
      const label = raw === null || raw === undefined || raw === "" ? value : String(raw);
      const rawSecondary = secondaryKey ? row[secondaryKey] : null;
      const secondary =
        rawSecondary === null || rawSecondary === undefined || rawSecondary === "" ? undefined : String(rawSecondary);
      return { value, label, secondary };
    }),
  );
}
