import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import type { ModuleDefinition, ModuleFieldDefinition, ModuleTabDefinition } from "./types";

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Busca a definição de um módulo (colunas, campos, abas) a partir das
 * tabelas de metadados `modules`/`module_tabs`/`module_fields`. Não sabe
 * nada sobre o domínio do módulo (Contact, Product etc.) — só monta a forma
 * que a tela deve assumir.
 */
export function useModuleDefinition(moduleId: string) {
  const [definition, setDefinition] = useState<ModuleDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!supabase) {
        setError(
          "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
        );
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const [moduleResult, tabsResult, fieldsResult] = await Promise.all([
        supabase.from("modules").select("*").eq("id", moduleId).single(),
        supabase.from("module_tabs").select("*").eq("module_id", moduleId).order("sort_order"),
        supabase.from("module_fields").select("*").eq("module_id", moduleId).order("sort_order"),
      ]);

      if (cancelled) return;

      if (moduleResult.error) {
        setError(moduleResult.error.message);
        setLoading(false);
        return;
      }

      const tabs: ModuleTabDefinition[] = (tabsResult.data ?? []).map((tab) => ({
        id: tab.tab_key,
        label: tab.label,
        sortOrder: tab.sort_order,
      }));

      const fields: ModuleFieldDefinition[] = (fieldsResult.data ?? []).map((field) => ({
        id: field.id,
        fieldKey: field.field_key,
        accessorKey: snakeToCamel(field.field_key),
        label: field.label,
        hint: field.hint,
        dataType: field.data_type as ModuleFieldDefinition["dataType"],
        isRequired: field.is_required,
        sortOrder: field.sort_order,
        showInTable: field.show_in_table,
        tableWidth: field.table_width,
        tableAlign: (field.table_align as ModuleFieldDefinition["tableAlign"]) ?? "left",
        showInDetails: field.show_in_details,
        showInForm: field.show_in_form,
        referenceModuleId: field.reference_module_id,
      }));

      setDefinition({
        id: moduleResult.data.id,
        label: moduleResult.data.label,
        dataTable: moduleResult.data.data_table,
        storageKind:
          moduleResult.data.storage_kind === "generic" ? "generic" : "table",
        layoutVariant: moduleResult.data.layout_variant as ModuleDefinition["layoutVariant"],
        isLocked: moduleResult.data.is_locked,
        tabs,
        fields,
      });
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  return { definition, loading, error };
}
