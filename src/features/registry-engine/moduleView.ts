import type { RegistryColumn, RegistryField } from "../../components/registry";
import type { ModuleFieldDefinition } from "./types";

function readAccessor(row: unknown, accessorKey: string): unknown {
  return (row as Record<string, unknown>)[accessorKey];
}

/** Monta as colunas da `RegistryTable` a partir dos campos com `showInTable`. */
export function buildTableColumns<TRow>(fields: ModuleFieldDefinition[]): RegistryColumn<TRow>[] {
  return fields
    .filter((field) => field.showInTable)
    .map((field) => ({
      key: field.fieldKey,
      label: field.label,
      width: field.tableWidth ?? "minmax(0, 1fr)",
      align: field.tableAlign,
      render: (row: TRow) => String(readAccessor(row, field.accessorKey) ?? ""),
    }));
}

/** Monta os campos da `RegistryDetails` (ficha) a partir dos campos com `showInDetails`. */
export function buildDetailFields<TRow>(
  fields: ModuleFieldDefinition[],
  row: TRow | null,
): RegistryField[] {
  return fields
    .filter((field) => field.showInDetails)
    .map((field) => ({
      label: field.label,
      value: row ? String(readAccessor(row, field.accessorKey) ?? "") : undefined,
    }));
}

/** Campos que devem aparecer no formulário de criação/edição, na ordem definida. */
export function buildFormFields(fields: ModuleFieldDefinition[]): ModuleFieldDefinition[] {
  return fields.filter((field) => field.showInForm);
}
