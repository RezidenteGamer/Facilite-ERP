import type { RegistryColumn, RegistryField } from "../../components/registry";
import type { ModuleFieldDefinition } from "./types";

/**
 * `accessorKey` → (`module_records.id` → rótulo legível) dos campos de
 * referência. Sem isto a tabela e a ficha mostrariam o uuid cru que está
 * gravado no jsonb; com isto mostram o registro apontado pelo nome que ele
 * tem no módulo de origem. Ver `useModuleReferences`.
 */
export type ReferenceLabels = Record<string, Record<string, string>>;

function readAccessor(row: unknown, accessorKey: string): unknown {
  return (row as Record<string, unknown>)[accessorKey];
}

function display(
  field: ModuleFieldDefinition,
  raw: unknown,
  referenceLabels?: ReferenceLabels,
): string {
  const value = raw === null || raw === undefined ? "" : String(raw);
  if (!field.referenceModuleId || !value) return value;
  return referenceLabels?.[field.accessorKey]?.[value] ?? value;
}

/** Monta as colunas da `RegistryTable` a partir dos campos com `showInTable`. */
export function buildTableColumns<TRow>(
  fields: ModuleFieldDefinition[],
  referenceLabels?: ReferenceLabels,
): RegistryColumn<TRow>[] {
  return fields
    .filter((field) => field.showInTable)
    .map((field) => ({
      key: field.fieldKey,
      label: field.label,
      width: field.tableWidth ?? "minmax(0, 1fr)",
      align: field.tableAlign,
      render: (row: TRow) => display(field, readAccessor(row, field.accessorKey), referenceLabels),
    }));
}

/** Monta os campos da `RegistryDetails` (ficha) a partir dos campos com `showInDetails`. */
export function buildDetailFields<TRow>(
  fields: ModuleFieldDefinition[],
  row: TRow | null,
  referenceLabels?: ReferenceLabels,
): RegistryField[] {
  return fields
    .filter((field) => field.showInDetails)
    .map((field) => ({
      label: field.label,
      value: row
        ? display(field, readAccessor(row, field.accessorKey), referenceLabels)
        : undefined,
    }));
}

/** Campos que devem aparecer no formulário de criação/edição, na ordem definida. */
export function buildFormFields(fields: ModuleFieldDefinition[]): ModuleFieldDefinition[] {
  return fields.filter((field) => field.showInForm);
}
