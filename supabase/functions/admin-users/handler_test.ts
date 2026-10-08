// Testa o handler real e o SDK real, substituindo somente o transporte HTTP.
// Não precisa de --allow-net, credenciais, .env ou servidor Supabase.
import { handleRequest } from "./handler.ts";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CALLER = "00000000-0000-0000-0000-000000000101";
const CREATED = "00000000-0000-0000-0000-000000000200";
const MANAGER = "00000000-0000-0000-0000-000000000003";
const ADMIN = "00000000-0000-0000-0000-000000000001";
const FOREIGN = "00000000-0000-0000-0000-000000000011";
const TARGET = "00000000-0000-0000-0000-000000000104";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Scenario = {
  bootstrap?: boolean;
  organizations?: string[];
  missingAdmin?: boolean;
  canManage?: boolean;
  canManagePermissions?: boolean;
  callerRoleOrganization?: string;
  active?: boolean;
  targetOrganization?: string | null;
  roleLookupError?: boolean;
  profileInsertError?: boolean;
  noToken?: boolean;
};

async function run(payload: Record<string, unknown>, scenario: Scenario = {}) {
  const previousFetch = globalThis.fetch;
  const env = { SUPABASE_URL: "https://mt4.invalid", SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: "test-service" };
  const previousEnv = Object.keys(env).map((key) => [key, Deno.env.get(key)] as const);
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const events: string[] = [];
  let insertedProfile: Record<string, unknown> | null = null;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    assert(url.hostname === "mt4.invalid", `Destino inesperado bloqueado: ${url.hostname}`);
    const path = url.pathname;
    events.push(`${req.method} ${path}`);
    if (path === "/auth/v1/user") return reply({ id: CALLER, aud: "authenticated", role: "authenticated" });
    if (path === "/rest/v1/profiles" && req.method === "HEAD") {
      return new Response(null, { headers: { "Content-Range": `0-0/${scenario.bootstrap ? 0 : 4}` } });
    }
    if (path === "/rest/v1/rpc/can_manage_users_for") return reply(scenario.canManage ?? true);
    if (path === "/rest/v1/organizations") return reply((scenario.organizations ?? [A]).map((id) => ({ id })));
    if (path === "/rest/v1/profiles" && req.method === "GET") {
      if (url.searchParams.get("id")?.startsWith("in.")) {
        return reply([
          { id: CALLER, organization_id: A },
          ...(scenario.targetOrganization === null ? [] : [{ id: TARGET, organization_id: scenario.targetOrganization ?? A }]),
        ]);
      }
      return reply({ organization_id: A, role_id: MANAGER, active: scenario.active ?? true });
    }
    if (path === "/rest/v1/roles") {
      events.push(`roles-query ${url.search}`);
      const isCallerLookup = url.searchParams.get("select")?.includes("can_manage_users");
      if (scenario.roleLookupError && !isCallerLookup) return reply({ message: "consulta recusada", code: "22P02" }, 400);
      const roles = [
        { id: MANAGER, name: "Gestor", organization_id: scenario.callerRoleOrganization ?? A,
          can_manage_users: true, can_manage_permissions: scenario.canManagePermissions ?? false },
        ...(!scenario.missingAdmin ? [{ id: ADMIN, name: "Administrador", organization_id: A }] : []),
        { id: FOREIGN, name: "Administrador", organization_id: B },
      ].filter((row) => ["id", "name", "organization_id"].every((key) => {
        const filter = url.searchParams.get(key);
        return !filter || filter === `eq.${row[key as "id" | "name" | "organization_id"]}`;
      }));
      if (req.headers.get("Accept")?.includes("vnd.pgrst.object")) {
        return roles.length === 1 ? reply(roles[0]) : reply({ code: "PGRST116", message: "0 rows" }, 406);
      }
      return reply(roles);
    }
    if (path === "/auth/v1/admin/users" && req.method === "POST") return reply({ id: CREATED });
    if (path === "/rest/v1/profiles" && req.method === "POST") {
      insertedProfile = await req.json();
      return scenario.profileInsertError ? reply({ message: "FK recusada", code: "23503" }, 409) : new Response(null, { status: 201 });
    }
    if (path === `/auth/v1/admin/users/${CREATED}` && req.method === "DELETE") return reply({ id: CREATED });
    if (path === `/auth/v1/admin/users/${TARGET}` && req.method === "PUT") return reply({ id: TARGET });
    throw new Error(`HTTP não previsto: ${req.method} ${url}`);
  };
  try {
    const response = await handleRequest(new Request("http://localhost/admin-users", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(scenario.noToken ? {} : { Authorization: "Bearer token-de-teste" }) },
      body: JSON.stringify(payload),
    }));
    return { status: response.status, body: await response.json(), events, insertedProfile: insertedProfile as Record<string, unknown> | null };
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

const create = (roleId: unknown) => ({ action: "create", email: "fixture@example.invalid", password: "test-password", name: "Fixture", roleId });

for (const [name, roleId, scenario, expected] of [
  ["gestor atribui próprio papel", MANAGER, {}, 200],
  ["gestor remove papel", null, {}, 200],
  ["papel omitido vira NULL", undefined, {}, 200],
  ["gestor não cria Administrador", ADMIN, {}, 403],
  ["gestor de permissões atribui papel local", ADMIN, { canManagePermissions: true }, 200],
  ["gestor não atribui papel estrangeiro", FOREIGN, {}, 403],
  ["administrador não atribui papel estrangeiro", FOREIGN, { canManagePermissions: true }, 403],
  ["papel inexistente", "00000000-0000-0000-0000-000000000099", { canManagePermissions: true }, 403],
  ["erro da consulta de papel", ADMIN, { roleLookupError: true }, 400],
  ["payload de papel inválido", { id: ADMIN }, {}, 400],
  ["gate can_manage_users continua obrigatório", null, { canManage: false }, 403],
  ["perfil inativo após o gate", MANAGER, { active: false }, 403],
  ["papel do chamador com organização divergente", MANAGER, { callerRoleOrganization: B }, 403],
  ["sem token", MANAGER, { noToken: true }, 401],
  ["bootstrap ignora papel enviado", FOREIGN, { bootstrap: true, noToken: true }, 200],
  ["bootstrap valida Administrador antes do Auth", null, { bootstrap: true, missingAdmin: true }, 500],
  ["bootstrap sem organização", ADMIN, { bootstrap: true, organizations: [] }, 500],
  ["bootstrap ambíguo", ADMIN, { bootstrap: true, organizations: [A, B] }, 500],
] as [string, unknown, Scenario, number][]) {
  Deno.test(name, async () => {
    const result = await run({ ...create(roleId), organization_id: B }, { ...scenario });
    assert(result.status === expected, `${name}: ${result.status} ${JSON.stringify(result.body)}`);
    const authCreate = result.events.indexOf("POST /auth/v1/admin/users");
    if (expected !== 200) {
      assert(authCreate === -1 && result.insertedProfile === null, "Recusa precisa acontecer ANTES de criar conta Auth");
    } else {
      assert(authCreate > -1, "Criação autorizada deve alcançar Auth");
      assert(result.insertedProfile?.organization_id === A, "Organização deve vir do servidor");
      assert(result.insertedProfile?.role_id === (scenario.bootstrap ? ADMIN : roleId ?? null), "Papel final inesperado");
      assert(result.events.slice(authCreate + 1).every((event) => !event.startsWith("roles-query")), "Papel precisa ser validado antes do Auth");
      if (scenario.bootstrap) {
        assert(result.events.some((event) => event.startsWith("roles-query") && event.includes(`organization_id=eq.${A}`)), "Administrador deve ser buscado na organização do bootstrap");
      }
    }
  });
}

Deno.test("erro posterior de perfil mantém rollback do usuário Auth", async () => {
  const result = await run(create(MANAGER), { profileInsertError: true });
  assert(result.status === 500 && result.events.includes(`DELETE /auth/v1/admin/users/${CREATED}`), "Rollback de Auth ausente");
});

for (const organization of [A, B, null]) {
  Deno.test(`reset-password preserva isolamento: ${organization ?? "inexistente"}`, async () => {
    const result = await run({ action: "reset-password", userId: TARGET, newPassword: "outra-senha" }, { targetOrganization: organization });
    assert(result.status === (organization === A ? 200 : 403), "Status de reset inesperado");
    assert(result.events.includes(`PUT /auth/v1/admin/users/${TARGET}`) === (organization === A), "Alvo estrangeiro/inexistente não pode alcançar Auth");
  });
}
