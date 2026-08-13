export type ModuleFieldDefinition = {
  id: string;
  /** Nome da coluna física na tabela de dados (snake_case). */
  fieldKey: string;
  /** Chave equivalente em camelCase, usada para ler o valor no objeto JS. */
  accessorKey: string;
  label: string;
  dataType: "text" | "date" | "boolean" | "phone" | "email";
  isRequired: boolean;
  sortOrder: number;
  showInTable: boolean;
  tableWidth: string | null;
  tableAlign: "left" | "center" | "right";
  showInDetails: boolean;
  showInForm: boolean;
};

export type ModuleTabDefinition = {
  id: string;
  label: string;
  sortOrder: number;
};

export type ModuleDefinition = {
  id: string;
  label: string;
  dataTable: string;
  layoutVariant: "three" | "table-controls" | "single";
  isLocked: boolean;
  tabs: ModuleTabDefinition[];
  fields: ModuleFieldDefinition[];
};
