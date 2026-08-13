import { supabase, supabaseUrl } from "../supabaseClient";

export type CreateUserInput = {
  email: string;
  password: string;
  name: string;
  document?: string;
  operatorCode?: string;
  roleId?: string | null;
};

async function callAdminUsers(body: Record<string, unknown>) {
  if (!supabase) {
    throw new Error("Supabase não está configurado.");
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const response = await fetch(`${supabaseUrl}/functions/v1/admin-users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error ?? "Erro na operação de administração de usuários.");
  }
  return result;
}

/** Cria um novo usuário (auth + perfil) via Edge Function (usa service_role no back-end). */
export async function createUser(input: CreateUserInput): Promise<{ userId: string }> {
  return callAdminUsers({ action: "create", ...input });
}

/** Reseta a senha de outro usuário via Edge Function (ação restrita a can_manage_users). */
export async function resetUserPassword(userId: string, newPassword: string): Promise<void> {
  await callAdminUsers({ action: "reset-password", userId, newPassword });
}
