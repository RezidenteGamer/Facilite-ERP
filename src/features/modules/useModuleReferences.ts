import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import type { ModuleFieldDefinition } from "../registry-engine/types";
import { extractErrorMessage } from "./useGenericModuleData";

export type ReferenceOption = { value: string; label: string };

/**
 * Opções dos campos de referência de um módulo — os que têm
 * `module_fields.reference_module_id` preenchido e por isso guardam, dentro
 * de `data`, um `module_records.id` de outro módulo genérico.
 *
 * Sem isto o campo seria um `<input>` de texto pedindo que alguém colasse um
 * uuid à mão, e a tabela mostraria o uuid de volta. O que a tela precisa
 * saber para montar a lista sai todo de metadados: o rótulo de cada opção é
 * o primeiro campo que aparece na tabela do módulo referenciado.
 *
 * Quem decide o que entra na lista continua sendo a RLS de `module_records`:
 * quem não pode ver o módulo referenciado recebe uma lista vazia — e é
 * exatamente por isso que **configurar** a referência e **disparar** uma
 * automação que a atravessa são coisas diferentes (ver o modelo de confiança
 * de `transition_module_record`).
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

    const pairs = signature.split("|").map((entry) => {
      const [accessorKey, moduleId] = entry.split(":");
      return { accessorKey, moduleId };
    });
    const moduleIds = [...new Set(pairs.map((pair) => pair.moduleId))];

    try {
      const perModule: Record<string, ReferenceOption[]> = {};

      for (const moduleId of moduleIds) {
        const [fieldsResult, recordsResult] = await Promise.all([
          supabase
            .from("module_fields")
            .select("field_key, show_in_table, sort_order")
            .eq("module_id", moduleId)
            .order("sort_order", { ascending: true }),
          supabase.from("module_records").select("id, data").eq("module_id", moduleId),
        ]);

        if (fieldsResult.error) throw fieldsResult.error;
        if (recordsResult.error) throw recordsResult.error;

        const labelKey =
          fieldsResult.data?.find((field) => field.show_in_table)?.field_key ??
          fieldsResult.data?.[0]?.field_key ??
          null;

        perModule[moduleId] = (recordsResult.data ?? [])
          .map((row) => {
            const data = (row.data ?? {}) as Record<string, unknown>;
            const raw = labelKey ? data[labelKey] : null;
            const label = raw === null || raw === undefined || raw === "" ? row.id : String(raw);
            return { value: row.id, label };
          })
          .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }));
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
