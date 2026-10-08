/** Postgres 17 descartável. Não aceita URL/credenciais de banco e não lê .env.
 * Executar: node supabase/verificacao/mt4_roles.mjs
 * Requer Docker local com a imagem postgres:17. Nenhuma porta é publicada.
 * O container, seus bancos e volumes são removidos em finally.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const baseline = read('../migrations/00000000000000_baseline.sql');
const migration = read('../migrations/00000000000022_mt4_roles_por_organizacao.sql');
const container = `facilite-mt4-${process.pid}-${Date.now()}`;
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
function requireSuccess(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}
function sql(source, { success = true, label = 'SQL' } = {}) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
    '--single-transaction', '-U', 'postgres', '-d', 'postgres'],
  { input: source, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  if (success) return requireSuccess(result, label);
  assert.notEqual(result.status, 0, `${label}: deveria falhar`);
  assert.equal(result.error, undefined);
  return result.stderr;
}
function baselineFunction(name) {
  const start = baseline.indexOf(`CREATE OR REPLACE FUNCTION "public"."${name}"(`);
  assert.ok(start >= 0, `Função do baseline ausente: ${name}`);
  const end = baseline.indexOf('$$;', start);
  assert.ok(end > start);
  return baseline.slice(start, end + 3);
}
function baselineTable(name) {
  const start = baseline.indexOf(`CREATE TABLE IF NOT EXISTS "public"."${name}" (`);
  assert.ok(start >= 0);
  return baseline.slice(start, baseline.indexOf('\n);', start) + 3);
}

// Recorte real do baseline, não uma reimplementação dos helpers/policies.
// auth.uid/role e auth.users são stubs locais; não há Auth/Data API neste PG.
const tables = ['roles', 'profiles', 'role_permissions'];
const helperNames = ['can_manage_permissions', 'can_manage_users', 'can_manage_users_for',
  'can_manage_branches', 'can_manage_modules', 'has_permission', 'prevent_role_escalation'];
const constraints = [...baseline.matchAll(/ALTER TABLE ONLY "public"\."(roles|profiles|role_permissions)"\s+ADD CONSTRAINT[^;]+;/g)].map((m) => m[0]);
const policies = [...baseline.matchAll(/CREATE POLICY[^\n]+ON "public"\."(roles|profiles|role_permissions)"[^;]+;/g)].map((m) => m[0]);
const grants = baseline.split('\n').filter((line) =>
  /^(GRANT|REVOKE)/.test(line) &&
  /(?:FUNCTION|TABLE) "public"\."(?:roles|profiles|role_permissions|can_manage_permissions|can_manage_users|can_manage_users_for|can_manage_branches|can_manage_modules|has_permission|prevent_role_escalation)"/.test(line));
const c3 = read('../migrations/00000000000002_c3_preco_e_desconto_do_banco.sql');
const c3Role = c3.slice(c3.indexOf('alter table public.roles'), c3.indexOf('create or replace function public.assert_discount_within_cap'));
const fixture = `
insert into public.roles (id, name, can_manage_permissions, can_manage_users, can_manage_branches, can_manage_modules)
values ('00000000-0000-0000-0000-000000000001', 'Administrador', true, true, true, true),
       ('00000000-0000-0000-0000-000000000002', 'Operador', false, false, false, false);
insert into auth.users (id) select ('00000000-0000-0000-0000-000000000' || n)::uuid from generate_series(101,104) n;
insert into public.profiles (id, name, role_id)
select id, 'Fixture ' || id, case when id::text like '%104' then '00000000-0000-0000-0000-000000000002'::uuid
else '00000000-0000-0000-0000-000000000001'::uuid end from auth.users;
insert into public.modules (id) select 'm' || n from generate_series(1,22) n;
insert into public.role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
select r.id, m.id, true, true, true, r.can_manage_permissions from public.roles r cross join public.modules m
where r.name = 'Administrador' or m.id in ('m1','m2','m3');
`;

const config = read('../config.toml');
const exposedSchemas = config.match(/^schemas\s*=\s*\[([^\]]+)\]/m)?.[1];
assert.ok(exposedSchemas && !exposedSchemas.includes('private'), 'private não pode ser exposto no config.toml');
assert.match(config, /\[functions\.admin-users\][\s\S]*?verify_jwt = false/);

let started = false;
try {
  requireSuccess(docker('run', '--detach', '--rm', '--name', container,
    '--network', 'none', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17'), 'Iniciar Postgres local');
  started = true;
  for (let attempt = 0; ; attempt++) {
    if (docker('exec', container, 'pg_isready', '-U', 'postgres').status === 0) break;
    if (attempt === 59) throw new Error('Postgres local não ficou pronto');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log(sql('show server_version;').trim());
  sql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant execute on functions to service_role;
    create table public.modules (id text primary key);
    create table public.branches (id uuid default gen_random_uuid() primary key, name text);
    create table public.user_branches (user_id uuid, branch_id uuid, primary key (user_id, branch_id));
    ${tables.map(baselineTable).join('\n')}
    ${constraints.join('\n')}
    ${helperNames.map(baselineFunction).join('\n')}
    ${policies.join('\n')}
    ${grants.join('\n')}
    ${c3Role}
    create index profiles_role_id_idx on public.profiles(role_id);
    create index role_permissions_module_id_idx on public.role_permissions(module_id);
    ${tables.map((table) => `alter table public.${table} enable row level security;`).join('\n')}
    create trigger profiles_prevent_role_escalation before update on public.profiles
      for each row execute function public.prevent_role_escalation();
    ${fixture}
    ${read('../migrations/00000000000019_mt1_organizations.sql')}
    update public.organizations set id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    ${read('../migrations/00000000000020_mt2_profiles_organization_id.sql')}
    ${read('../migrations/00000000000021_mt3_organizacao_nas_funcoes_de_autorizacao.sql')}
  `, { label: 'Schema anterior: baseline relevante + C3 + MT1/MT2/MT3 reais' });

  // Mesma asserção de invisibilidade usada na suíte positiva. Não falha
  // por coluna ausente: o registro estrangeiro é identificado pelo UUID.
  const negative = sql(`
    insert into public.roles(id, name) values ('00000000-0000-0000-0000-000000000011', 'Fixture estrangeira');
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}';
    ${read('./mt4_roles_invisibilidade.sql')}
  `, { success: false, label: 'Controle negativo pré-MT4' });
  assert.match(negative, /MT4_ISOLAMENTO: papel estrangeiro visível/);
  console.log('PASS controle negativo: a asserção central REPROVOU no schema pré-MT4');

  for (const [label, prefix] of [
    ['zero organizações', 'delete from public.profiles; delete from public.organizations;'],
    ['duas organizações', "insert into public.organizations(name) values ('Ambígua');"],
  ]) {
    const error = sql(prefix + migration, { success: false, label });
    assert.match(error, /MT4: esperava exatamente 1 organização/);
    console.log(`PASS guarda de backfill: ${label} recusadas; transação revertida`);
  }
  sql(migration, { label: 'Aplicar MT4' });
  sql(migration, { label: 'Reexecutar MT4' });
  console.log('PASS aplicação e reexecução da migration integral');
  console.log(sql(read('./mt4_roles.sql').replace('-- ASSERT_INVISIBILIDADE', () => read('./mt4_roles_invisibilidade.sql')),
    { label: 'Asserções MT4' }).split('\n').filter((line) => line.startsWith('PASS')).join('\n'));
  sql(migration, { label: 'Reexecutar MT4 com duas organizações' });
  console.log('PASS reexecução após a segunda organização; config local mantém private fora do Data API');
} finally {
  if (started) {
    requireSuccess(docker('rm', '--force', '--volumes', container), 'Remover somente o container descartável MT4');
    console.log('PASS container e volumes descartáveis removidos');
  }
}
