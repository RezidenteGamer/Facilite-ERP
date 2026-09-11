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

  let callerId: string | null = null;

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
    callerId = userData.user.id;

    const { data: canManage, error: canManageError } = await admin.rpc("can_manage_users_for", {
      p_user_id: callerId,
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

    // Resolve organization_id ANTES de criar o usuário no Supabase Auth —
    // se a resolução falhar, a função retorna sem deixar usuário órfão em
    // auth.users (MT2, ver facilite-multi-tenant-saas.md).
    let organizationId: string;
    if (isBootstrap) {
      // MT2 (Etapa 1) — ponte temporária, não a solução de MT9.
      //
      // O bootstrap desta função só serve para o primeiríssimo usuário da
      // primeiríssima organização: a checagem "profiles está vazia" só
      // faz sentido enquanto existir uma organização só no sistema
      // inteiro, porque não há nenhum caminho (ainda) para uma segunda
      // organização cadastrar o próprio primeiro usuário — isso é
      // ovo-e-galinha (can_manage_users_for exige já ser usuário de uma
      // organização) e é exatamente o motivo de existir MT9 (Etapa 4,
      // "uma organização nasce sozinha"). Até MT9 substituir este
      // mecanismo por um provisionamento real, o bootstrap exige que
      // `organizations` tenha exatamente uma linha e usa o id dela — se
      // não tiver, falha de forma explícita em vez de adivinhar qual
      // organização usar ou criar uma organização nova aqui.
      const { data: orgs, error: orgsError } = await admin
        .from("organizations")
        .select("id");
      if (orgsError) {
        return jsonResponse({ error: `Erro ao verificar organizações existentes: ${orgsError.message}` }, 500);
      }
      if (!orgs || orgs.length !== 1) {
        return jsonResponse({
          error:
            `Bootstrap indisponível: esperava exatamente 1 organização para criar o primeiro usuário sem ambiguidade, encontrou ${orgs?.length ?? 0}. Isto exige MT9 (provisionamento de organização nova) para ser resolvido.`,
        }, 500);
      }
      organizationId = orgs[0].id;
    } else {
      // Caminho normal: todo usuário criado nasce na mesma organização de
      // quem o criou — resolvida a partir do perfil do chamador, nunca de
      // um campo vindo do front-end.
      const { data: callerProfile, error: callerProfileError } = await admin
        .from("profiles")
        .select("organization_id")
        .eq("id", callerId)
        .single();
      if (callerProfileError || !callerProfile) {
        return jsonResponse({ error: `Erro ao resolver organização do usuário autenticado: ${callerProfileError?.message ?? "perfil não encontrado"}` }, 500);
      }
      organizationId = callerProfile.organization_id;
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
      organization_id: organizationId,
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
