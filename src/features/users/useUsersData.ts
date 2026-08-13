import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { createUser, resetUserPassword, type CreateUserInput } from "../../lib/repositories/adminUsersApi";
import type { Role, SystemUser } from "./users";

function assertSupabase() {
  if (!supabase) {
    throw new Error("Supabase não está configurado.");
  }
  return supabase;
}

/** Carrega usuários (profiles + papel) e papéis disponíveis, com mutações via Supabase/Edge Function. */
export function useUsersData() {
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = assertSupabase();
      const [usersResult, rolesResult] = await Promise.all([
        client
          .from("profiles")
          .select("id, code, name, document, operator_code, active, email, role_id, roles(name)")
          .order("created_at", { ascending: true }),
        client.from("roles").select("*").order("name", { ascending: true }),
      ]);

      if (usersResult.error) throw usersResult.error;
      if (rolesResult.error) throw rolesResult.error;

      setUsers(
        (usersResult.data ?? []).map((row) => {
          const role = row.roles as unknown as { name: string } | null;
          return {
            id: row.id,
            code: row.code,
            name: row.name,
            document: row.document,
            operatorCode: row.operator_code,
            active: row.active,
            email: row.email,
            roleId: row.role_id,
            roleName: role?.name ?? null,
          };
        }),
      );
      setRoles(
        (rolesResult.data ?? []).map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          canManagePermissions: role.can_manage_permissions,
          canManageUsers: role.can_manage_users,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar usuários.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function createUserAndReload(input: CreateUserInput) {
    await createUser(input);
    await reload();
  }

  async function updateUser(
    id: string,
    patch: Partial<Pick<SystemUser, "name" | "document" | "operatorCode" | "active" | "roleId">>,
  ) {
    const client = assertSupabase();
    const { error: updateError } = await client
      .from("profiles")
      .update({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.document !== undefined && { document: patch.document }),
        ...(patch.operatorCode !== undefined && { operator_code: patch.operatorCode }),
        ...(patch.active !== undefined && { active: patch.active }),
        ...(patch.roleId !== undefined && { role_id: patch.roleId }),
      })
      .eq("id", id);
    if (updateError) throw updateError;
    await reload();
  }

  async function resetPassword(userId: string, newPassword: string) {
    await resetUserPassword(userId, newPassword);
  }

  return { users, roles, loading, error, reload, createUser: createUserAndReload, updateUser, resetPassword };
}
