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
  /** Nulo em módulos de navegação sem dados próprios (telas mock/administrativas). */
  dataTable: string | null;
  /**
   * `three`/`table-controls`/`single` são variações da tela de registro único
   * (criar/editar um por vez, via `RegistryFormModal`). `batch` é a tela de
   * lançamento em lote: o formulário acumula N linhas e confirma tudo numa
   * escrita atômica só (ver `RegistryBatchFormModal`).
   */
  layoutVariant: "three" | "table-controls" | "single" | "batch";
  isLocked: boolean;
  tabs: ModuleTabDefinition[];
  fields: ModuleFieldDefinition[];
};
