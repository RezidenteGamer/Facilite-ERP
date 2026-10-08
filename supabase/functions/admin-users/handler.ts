import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { canAssignRole } from "./roleAssignment.ts";

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
  roleId?: string | null;
};

type ResetPasswordPayload = {
  action: "reset-password";
  userId: string;
  newPassword: string;
};

type RequestPayload = CreatePayload | ResetPasswordPayload;

export async function handleRequest(req: Request) {
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

    // MT4: resolve organização E atribuição de papel antes de tocar no Auth.
    // service_role ignora RLS e o trigger de edição; esta é a autoridade
    // para criação. Nenhum erro de papel pode criar uma conta órfã.
    let organizationId: string;
    let roleId: string | null;
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

      // Ignora qualquer roleId do cliente. A existência do Administrador
      // desta organização é pré-condição, nunca um fallback para NULL.
      const { data: adminRole, error: adminRoleError } = await admin
        .from("roles")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("name", "Administrador")
        .single();
      if (adminRoleError || !adminRole) {
        return jsonResponse({ error: "Bootstrap indisponível: papel Administrador da organização não encontrado." }, 500);
      }
      roleId = adminRole.id;
    } else {
      // Caminho normal: todo usuário criado nasce na mesma organização de
      // quem o criou — resolvida a partir do perfil do chamador, nunca de
      // um campo vindo do front-end.
      const { data: callerProfile, error: callerProfileError } = await admin
        .from("profiles")
        .select("organization_id, role_id, active")
        .eq("id", callerId)
        .single();
      if (callerProfileError || !callerProfile) {
        return jsonResponse({ error: `Erro ao resolver organização do usuário autenticado: ${callerProfileError?.message ?? "perfil não encontrado"}` }, 500);
      }
      organizationId = callerProfile.organization_id;
      const { data: callerRole, error: callerRoleError } = await admin
        .from("roles")
        .select("id, organization_id, can_manage_users, can_manage_permissions")
        .eq("id", callerProfile.role_id)
        .eq("organization_id", organizationId)
        .single();
      if (callerRoleError || !callerProfile.active || !callerRole?.can_manage_users) {
        return jsonResponse({ error: "Você não tem permissão para gerenciar usuários." }, 403);
      }
      if (payload.roleId != null && (typeof payload.roleId !== "string" || !payload.roleId)) {
        return jsonResponse({ error: "Papel de acesso inválido." }, 400);
      }
      roleId = payload.roleId ?? null;
      let requestedRole = null;
      if (roleId !== null) {
        const { data, error } = await admin.from("roles")
          .select("id, organization_id")
          .eq("id", roleId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (error) {
          return jsonResponse({ error: "Não foi possível validar o papel solicitado." }, 400);
        }
        requestedRole = data ? { id: data.id, organizationId: data.organization_id } : null;
      }
      if (!canAssignRole({
        organizationId,
        roleId: callerRole.id,
        canManagePermissions: callerRole.can_manage_permissions,
      }, roleId, requestedRole)) {
        return jsonResponse({ error: "Você não pode atribuir este papel de acesso." }, 403);
      }
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      return jsonResponse({ error: createError?.message ?? "Erro ao criar usuário." }, 400);
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

    // MT3 (11/09/2026, ver facilite-multi-tenant-saas.md) — buraco que era
    // explorável ANTES de existir uma segunda organização: até aqui, esta
    // ação conferia só `can_manage_users_for(callerId)` (o papel de quem
    // chama) e depois resetava a senha do `userId` que viesse no payload,
    // sem nenhuma checagem sobre QUEM é esse usuário. Ou seja: qualquer
    // conta com `can_manage_users = true` trocava a senha de qualquer outra
    // conta do sistema inteiro, de qualquer filial — inclusive a de um
    // administrador, tomando a conta dele. Não dava para corrigir na RLS:
    // esta função roda com `service_role`, que passa por cima de policy por
    // definição, então a checagem tem de estar aqui no código.
    //
    // `callerId` é sempre não-nulo neste ponto: `isBootstrap` exige
    // `action === "create"`, então reset-password nunca entra pelo caminho
    // de bootstrap e sempre passou pelo bloco de autenticação acima.
    const { data: profilePair, error: profilePairError } = await admin
      .from("profiles")
      .select("id, organization_id")
      .in("id", [callerId, userId]);
    if (profilePairError) {
      return jsonResponse({ error: `Erro ao verificar organização: ${profilePairError.message}` }, 500);
    }

    const callerOrganizationId = profilePair?.find((row) => row.id === callerId)?.organization_id ?? null;
    const targetOrganizationId = profilePair?.find((row) => row.id === userId)?.organization_id ?? null;

    // Perfil alvo inexistente cai aqui com a mesma mensagem de organização
    // diferente, de propósito: responder "esse usuário não existe" de forma
    // distinguível transformaria esta ação num enumerador de contas para
    // quem já tem `can_manage_users` numa organização qualquer.
    if (!callerOrganizationId || !targetOrganizationId || callerOrganizationId !== targetOrganizationId) {
      return jsonResponse(
        { error: "Você só pode redefinir a senha de usuários da sua própria organização." },
        403,
      );
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
}
