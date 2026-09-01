import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import type { Role } from "../users/users";

export type ModuleOption = { id: string; label: string };

export type PermissionCell = {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export type PermissionAction = "view" | "create" | "edit" | "delete";

function assertSupabase() {
  if (!supabase) {
    throw new Error("Supabase não está configurado.");
  }
  return supabase;
}

const EMPTY_CELL: PermissionCell = { canView: false, canCreate: false, canEdit: false, canDelete: false };

/** Carrega papéis, módulos e a grade de permissões (papel × módulo) para a tela de administração. */
export function usePermissionsData() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [matrix, setMatrix] = useState<Record<string, Record<string, PermissionCell>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = assertSupabase();
      const [rolesResult, modulesResult, permsResult] = await Promise.all([
        client.from("roles").select("*").order("name", { ascending: true }),
        /* Só os módulos que realmente passam por `has_permission`. As telas
           administrativas (`/permissoes`, `/usuarios-operadores`,
           `/configuracoes`) também vivem no catálogo, mas são controladas
           pelas flags globais do papel — mostrá-las aqui daria quatro
           checkboxes que não decidem nada e sugeriria que desmarcar "Ver" em
           Permissões tranca a tela, o que não é verdade. */
        client
          .from("modules")
          .select("id, label")
          .eq("access_gate", "permission")
          .order("label", { ascending: true }),
        client.from("role_permissions").select("*"),
      ]);

      if (rolesResult.error) throw rolesResult.error;
      if (modulesResult.error) throw modulesResult.error;
      if (permsResult.error) throw permsResult.error;

      setRoles(
        (rolesResult.data ?? []).map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          canManagePermissions: role.can_manage_permissions,
          canManageUsers: role.can_manage_users,
          maxDiscountPercent: role.max_discount_percent,
        })),
      );
      setModules((modulesResult.data ?? []).map((m) => ({ id: m.id, label: m.label })));

      const nextMatrix: Record<string, Record<string, PermissionCell>> = {};
      for (const perm of permsResult.data ?? []) {
        nextMatrix[perm.role_id] ??= {};
        nextMatrix[perm.role_id][perm.module_id] = {
          canView: perm.can_view,
          canCreate: perm.can_create,
          canEdit: perm.can_edit,
          canDelete: perm.can_delete,
        };
      }
      setMatrix(nextMatrix);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar permissões.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function cellFor(roleId: string, moduleId: string): PermissionCell {
    return matrix[roleId]?.[moduleId] ?? EMPTY_CELL;
  }

  async function setPermission(roleId: string, moduleId: string, action: PermissionAction, value: boolean) {
    const client = assertSupabase();
    const current = cellFor(roleId, moduleId);
    const next: PermissionCell = {
      canView: action === "view" ? value : current.canView,
      canCreate: action === "create" ? value : current.canCreate,
      canEdit: action === "edit" ? value : current.canEdit,
      canDelete: action === "delete" ? value : current.canDelete,
    };

    const { error: upsertError } = await client.from("role_permissions").upsert(
      {
        role_id: roleId,
        module_id: moduleId,
        can_view: next.canView,
        can_create: next.canCreate,
        can_edit: next.canEdit,
        can_delete: next.canDelete,
      },
      { onConflict: "role_id,module_id" },
    );
    if (upsertError) throw upsertError;

    setMatrix((prev) => ({ ...prev, [roleId]: { ...prev[roleId], [moduleId]: next } }));
  }

  async function setRoleCapability(
    roleId: string,
    field: "canManagePermissions" | "canManageUsers",
    value: boolean,
  ) {
    const client = assertSupabase();
    const patch =
      field === "canManagePermissions" ? { can_manage_permissions: value } : { can_manage_users: value };
    const { error: updateError } = await client.from("roles").update(patch).eq("id", roleId);
    if (updateError) throw updateError;
    setRoles((prev) => prev.map((role) => (role.id === roleId ? { ...role, [field]: value } : role)));
  }

  /**
   * `value` nulo = sem teto. Validado no banco (`assert_discount_within_cap`)
   * de qualquer forma — esta função só evita mandar um valor fora de 0–100
   * e uma volta desnecessária ao servidor para descobrir isso.
   */
  async function setRoleMaxDiscount(roleId: string, value: number | null) {
    if (value !== null && (Number.isNaN(value) || value < 0 || value > 100)) {
      throw new Error("O teto de desconto precisa ser um número entre 0 e 100, ou vazio para não ter teto.");
    }
    const client = assertSupabase();
    const { error: updateError } = await client
      .from("roles")
      .update({ max_discount_percent: value })
      .eq("id", roleId);
    if (updateError) throw updateError;
    setRoles((prev) => prev.map((role) => (role.id === roleId ? { ...role, maxDiscountPercent: value } : role)));
  }

  async function createRole(name: string, description: string) {
    const client = assertSupabase();
    const { error: insertError } = await client.from("roles").insert({ name, description: description || null });
    if (insertError) throw insertError;
    await reload();
  }

  return { roles, modules, loading, error, cellFor, setPermission, setRoleCapability, setRoleMaxDiscount, createRole };
}
