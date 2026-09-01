import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

type CreatePayload = {
  action: "create";
  email: string;
  password: string;
  name: string;
  document?: string;
  operatorCode?: string;
  roleId?: string;
};

type ResetPasswordPayload = {
  action: "reset-password";
  userId: string;
  newPassword: string;
};

type RequestPayload = CreatePayload | ResetPasswordPayload;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não suportado." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const admin = createClient(supabaseUrl, serviceRoleKey);

  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Corpo da requisição inválido." }, 400);
  }

  // Descobre se o sistema ainda não tem nenhum perfil (bootstrap do
  // primeiro administrador) — nesse caso libera a criação sem exigir
  // permissão, já que ainda não existe ninguém com `can_manage_users`.
  const { count: profileCount, error: countError } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true });

  if (countError) {
    return jsonResponse({ error: `Erro ao verificar perfis existentes: ${countError.message}` }, 500);
  }

  // O bootstrap só libera a criação do primeiro usuário sem permissão —
  // qualquer outra ação (ex.: reset de senha) sempre exige can_manage_users.
  const isBootstrap = (profileCount ?? 0) === 0 && payload.action === "create";

  if (!isBootstrap) {
    // Fora do bootstrap, exige um usuário autenticado com can_manage_users.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return jsonResponse({ error: "Não autenticado." }, 401);
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: "Não autenticado." }, 401);
    }

    const { data: canManage, error: canManageError } = await admin.rpc("can_manage_users_for", {
      p_user_id: userData.user.id,
    });
    if (canManageError) {
      return jsonResponse({ error: `Erro ao checar permissão: ${canManageError.message}` }, 500);
    }
    if (!canManage) {
      return jsonResponse({ error: "Você não tem permissão para gerenciar usuários." }, 403);
    }
  }

  if (payload.action === "create") {
    const { email, password, name, document, operatorCode } = payload;
    if (!email || !password || !name) {
      return jsonResponse({ error: "Email, senha e nome são obrigatórios." }, 400);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      return jsonResponse({ error: createError?.message ?? "Erro ao criar usuário." }, 400);
    }

    let roleId = payload.roleId ?? null;
    if (isBootstrap) {
      // No bootstrap, ignora qualquer roleId vindo do cliente e usa sempre
      // o papel "Administrador" semeado pela migration.
      const { data: adminRole } = await admin
        .from("roles")
        .select("id")
        .eq("name", "Administrador")
        .single();
      roleId = adminRole?.id ?? null;
    }

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      email,
      name,
      document: document ?? "",
      operator_code: operatorCode ?? "",
      role_id: roleId,
    });
    if (profileError) {
      // Reverte a criação do usuário de auth para não deixar órfão.
      await admin.auth.admin.deleteUser(created.user.id);
      return jsonResponse({ error: `Erro ao criar perfil: ${profileError.message}` }, 500);
    }

    return jsonResponse({ userId: created.user.id });
  }

  if (payload.action === "reset-password") {
    const { userId, newPassword } = payload;
    if (!userId || !newPassword) {
      return jsonResponse({ error: "userId e newPassword são obrigatórios." }, 400);
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });
    if (updateError) {
      return jsonResponse({ error: updateError.message }, 400);
    }

    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "Ação desconhecida." }, 400);
});
