import type { ModuleStorageKind } from "../../lib/repositories/genericModuleRepository";

/** Reexportado para quem já importa os tipos do motor não precisar de dois caminhos. */
export type { ModuleStorageKind };

export type ModuleFieldDefinition = {
  id: string;
  /** Nome da coluna física na tabela de dados (snake_case). */
  fieldKey: string;
  /** Chave equivalente em camelCase, usada para ler o valor no objeto JS. */
  accessorKey: string;
  label: string;
  /** Texto curto de apoio abaixo do campo, exibido só onde o formulário optar por mostrá-lo. */
  hint?: string | null;
  dataType: "text" | "date" | "boolean" | "phone" | "email";
  isRequired: boolean;
  sortOrder: number;
  showInTable: boolean;
  tableWidth: string | null;
  tableAlign: "left" | "center" | "right";
  showInDetails: boolean;
  showInForm: boolean;
  /**
   * Quando preenchido, o valor deste campo é o `id` de um registro de outro
   * módulo — a base tanto para mostrar dado relacionado quanto (nos módulos
   * `generic`) para uma ação de transição alcançar "em qual registro do
   * outro módulo" escrever. O módulo referenciado e o dono do campo têm
   * sempre o mesmo `storage_kind`: `generic` aponta para um `module_records.id`,
   * `table` aponta para o `id` de uma linha na tabela dedicada (ex.:
   * Tributações → `ufs`/`cfop`/etc.). Só desenvolvedor do Facilite define
   * (trigger `module_fields_guard_reference` no banco).
   */
  referenceModuleId: string | null;
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
   * Onde o dado deste módulo mora fisicamente (a coluna
   * `modules.storage_kind`): `table` = a tabela dedicada de `dataTable`;
   * `generic` = linhas em `module_records`, com o corpo do registro em jsonb
   * (o caminho dos módulos criados pelo usuário).
   */
  storageKind: ModuleStorageKind;
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
