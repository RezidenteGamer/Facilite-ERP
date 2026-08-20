import { supabase } from "../../lib/supabaseClient";
import type { ModuleStorageKind } from "../../lib/repositories/genericModuleRepository";

/**
 * Qual portão decide quem entra num módulo. As telas administrativas
 * (`/permissoes`, `/usuarios-operadores`, `/configuracoes`) **não** passam
 * por `has_permission` — elas são controladas pelas flags globais do papel.
 * Tratá-las como módulo comum criaria um segundo portão que ninguém tem
 * marcado e trancaria todo mundo para fora da própria tela usada para
 * consertar permissões.
 */
export type ModuleAccessGate =
  | "permission"
  | "manage_users"
  | "manage_permissions"
  | "manage_branches"
  | "manage_modules"
  | "authenticated";

/** Uma linha do catálogo de navegação (tabela `modules`). */
export type CatalogModule = {
  id: string;
  label: string;
  /** Nulo = item de catálogo sem tela própria (ex.: Relatórios). */
  path: string | null;
  /** Chave no registro de ícones do código; cai no `id` quando vem nula. */
  iconKey: string;
  sortOrder: number;
  showOnHome: boolean;
  accessGate: ModuleAccessGate;
  /** Tabela de dados — só o motor genérico precisa dela, e só no caminho `table`. */
  dataTable: string | null;
  /**
   * Onde o dado do módulo mora: `table` (a tabela dedicada de `dataTable`) ou
   * `generic` (linhas em `module_records`). É coluna no banco, e não
   * convenção de código, porque é uma pergunta sobre onde o dado físico
   * está — nada no bundle poderia responder por ela.
   */
  storageKind: ModuleStorageKind;
  layoutVariant: string;
  /** True = módulo de sistema; false = módulo criado pelo usuário (M3). */
  isLocked: boolean;
  /** Tabela isolada por filial: o motor genérico filtra/grava com a filial ativa. */
  branchScoped: boolean;
};

const VALID_GATES: ModuleAccessGate[] = [
  "permission",
  "manage_users",
  "manage_permissions",
  "manage_branches",
  "manage_modules",
  "authenticated",
];

/**
 * Um valor de portão desconhecido vira `permission` — o portão mais restritivo
 * dos seis (exige uma linha marcada em `role_permissions`). Falhar fechado
 * aqui é de propósito: o contrário abriria uma tela administrativa por causa
 * de um erro de digitação. Na prática o CHECK da coluna torna isso inalcançável.
 */
function toGate(value: string): ModuleAccessGate {
  return (VALID_GATES as string[]).includes(value) ? (value as ModuleAccessGate) : "permission";
}

/**
 * Lê o catálogo inteiro de módulos do banco. É a única fonte da verdade de
 * "quais módulos existem" — roteador, tela inicial e dock leem todos daqui.
 * O que continua em código é só o que não cabe no Postgres: o componente de
 * cada módulo e o asset do ícone (ver `moduleComponents.ts`/`moduleIcons.ts`).
 */
export async function fetchModuleCatalog(): Promise<CatalogModule[]> {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }

  const { data, error } = await supabase
    .from("modules")
    .select(
      "id, label, path, icon_key, sort_order, show_on_home, access_gate, data_table, storage_kind, layout_variant, is_locked, branch_scoped",
    )
    .order("sort_order", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    path: row.path,
    iconKey: row.icon_key ?? row.id,
    sortOrder: row.sort_order,
    showOnHome: row.show_on_home,
    accessGate: toGate(row.access_gate),
    dataTable: row.data_table,
    storageKind: row.storage_kind === "generic" ? "generic" : "table",
    layoutVariant: row.layout_variant,
    isLocked: row.is_locked,
    branchScoped: row.branch_scoped,
  }));
}
