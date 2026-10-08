-- Executado exclusivamente pelo runner mt4_roles.mjs no container descartável.
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'MT4_ASSERT: %', label; end if;
end $$;
create function pg_temp.expect_error(statement text, expected_state text, label text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
  end;
  -- Não engole FK/NOT NULL/erros de sintaxe como se fossem recusa de RLS.
  perform pg_temp.assert_true(actual_state = expected_state,
    label || ': esperado ' || expected_state || ', obtido ' || coalesce(actual_state, 'SUCESSO INDEVIDO'));
end $$;
create function pg_temp.login(user_id text, db_role text default 'authenticated') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', db_role)::text, true);
end;
$$;

select pg_temp.assert_true((select count(*) = 2 and bool_and(organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') from public.roles), 'backfill dos 2 papéis');
select pg_temp.assert_true((select count(*) = 25 and bool_and(organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') from public.role_permissions), 'backfill das 25 permissões');
select pg_temp.assert_true((select count(*) = 4 from public.profiles), '4 perfis preservados');
select pg_temp.assert_true((select count(*) = 22 from public.role_permissions where role_id = '00000000-0000-0000-0000-000000000001'), '22 permissões de Administrador');
select pg_temp.assert_true((select count(*) = 3 from public.role_permissions where role_id = '00000000-0000-0000-0000-000000000002'), '3 permissões de Operador');
select 'PASS backfill: 2 papéis, 25 permissões (22/3), 4 perfis';
select pg_temp.assert_true(
  to_regclass('public.profiles_role_id_organization_id_idx') is not null
  and to_regclass('public.role_permissions_role_id_organization_id_idx') is not null,
  'índices cobrem as duas FKs compostas'
);
select 'PASS índices de cobertura das duas FKs compostas';

insert into public.organizations(id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Organização B descartável');
insert into public.roles(id, organization_id, name, can_manage_permissions, can_manage_users, can_manage_branches, can_manage_modules, max_discount_percent) values
  ('00000000-0000-0000-0000-000000000011', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Administrador', true, true, true, true, 90),
  ('00000000-0000-0000-0000-000000000012', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Operador', false, false, false, false, 5),
  ('00000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Gestor de usuários', false, true, false, false, 10),
  ('00000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Outro papel', false, false, false, false, null),
  ('00000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Só permissões', true, false, false, false, null);
insert into auth.users(id) select ('00000000-0000-0000-0000-000000000' || n)::uuid from generate_series(105,109) n;
insert into public.profiles(id, organization_id, name, role_id, active) values
  ('00000000-0000-0000-0000-000000000105', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Gestor', '00000000-0000-0000-0000-000000000003', true),
  ('00000000-0000-0000-0000-000000000106', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sem papel', null, true),
  ('00000000-0000-0000-0000-000000000107', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Só permissões', '00000000-0000-0000-0000-000000000005', true),
  ('00000000-0000-0000-0000-000000000108', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Inativo', '00000000-0000-0000-0000-000000000001', false),
  ('00000000-0000-0000-0000-000000000109', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Admin B', '00000000-0000-0000-0000-000000000011', true);
insert into public.modules(id) values ('only-b');
insert into public.role_permissions(role_id, organization_id, module_id, can_view) values
  ('00000000-0000-0000-0000-000000000011', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'only-b', true),
  ('00000000-0000-0000-0000-000000000011', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'm1', false),
  ('00000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'm1', true);
select pg_temp.expect_error($s$insert into public.roles(name, organization_id) values ('Administrador', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$s$, '23505', 'nome duplicado na mesma organização');
select pg_temp.expect_error($s$insert into public.roles(name) values ('Sem organização')$s$, '23502', 'SQL sem sessão exige organização explícita');
select 'PASS mesmos nomes em A/B; duplicação local e default sem sessão recusados';

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-000000000101');
-- ASSERT_INVISIBILIDADE
select pg_temp.assert_true((select count(*) = 5 from public.roles), 'A lê todos os seus 5 papéis');
select pg_temp.assert_true((select count(*) = 0 from public.role_permissions where organization_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 'A não lê permissões B');
select pg_temp.assert_true(public.has_permission('m1','delete') is true, 'permissão A funciona');
select pg_temp.assert_true(not coalesce(public.has_permission('only-b','view'), false), 'permissão B não concede acesso a A');
select pg_temp.assert_true(public.has_permission('m1','ação-inválida') is false, 'ação inválida negada');
select pg_temp.expect_error($s$insert into public.roles(name, organization_id) values ('Invasão', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$s$, '42501', 'insert papel B');
select pg_temp.expect_error($s$insert into public.role_permissions(role_id, module_id, organization_id) values ('00000000-0000-0000-0000-000000000011', 'm2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$s$, '42501', 'insert permissão B');
with changed as (update public.roles set description = 'Invasão' where id = '00000000-0000-0000-0000-000000000011' returning *)
select pg_temp.assert_true((select count(*) = 0 from changed), 'update papel B não alcança linha');
with changed as (delete from public.roles where id = '00000000-0000-0000-0000-000000000012' returning *)
select pg_temp.assert_true((select count(*) = 0 from changed), 'delete papel B não alcança linha');
with changed as (update public.role_permissions set can_view = false where role_id = '00000000-0000-0000-0000-000000000011' returning *)
select pg_temp.assert_true((select count(*) = 0 from changed), 'update permissão B não alcança linha');
with changed as (delete from public.role_permissions where role_id = '00000000-0000-0000-0000-000000000011' returning *)
select pg_temp.assert_true((select count(*) = 0 from changed), 'delete permissão B não alcança linha');
select pg_temp.expect_error($s$update public.roles set organization_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = '00000000-0000-0000-0000-000000000004'$s$, '42501', 'WITH CHECK papel');
select pg_temp.expect_error($s$update public.role_permissions set organization_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where role_id = '00000000-0000-0000-0000-000000000001' and module_id = 'm1'$s$, '42501', 'WITH CHECK permissão');
select 'PASS RLS: SELECT/INSERT/UPDATE/DELETE estrangeiros e mudança de organização bloqueados';

-- Contratos reais do front: insert de papel e ambos os caminhos do upsert,
-- todos sem organization_id. Exercita também escrita permitida por A.
insert into public.roles(id, name) values ('00000000-0000-0000-0000-000000000020', 'Papel criado pela tela');
insert into public.role_permissions(role_id, module_id, can_view)
values ('00000000-0000-0000-0000-000000000020', 'm1', true)
on conflict (role_id, module_id) do update set can_view = excluded.can_view;
insert into public.role_permissions(role_id, module_id, can_view)
values ('00000000-0000-0000-0000-000000000020', 'm1', false)
on conflict (role_id, module_id) do update set can_view = excluded.can_view;
select pg_temp.assert_true((select organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and not can_view from public.role_permissions where role_id = '00000000-0000-0000-0000-000000000020'), 'upsert herda A e atualiza');
select pg_temp.expect_error($s$insert into public.role_permissions(role_id, module_id, can_view) values ('00000000-0000-0000-0000-000000000011','m1',true) on conflict (role_id,module_id) do update set can_view = excluded.can_view$s$, '42501', 'upsert estrangeiro não bypassa RLS');
delete from public.roles where id = '00000000-0000-0000-0000-000000000020';
select pg_temp.assert_true((select count(*) = 0 from public.role_permissions where role_id = '00000000-0000-0000-0000-000000000020'), 'cascade preservado');
select pg_temp.expect_error($s$delete from public.roles where id = '00000000-0000-0000-0000-000000000001'$s$, '23503', 'papel em uso não pode ser excluído');
select 'PASS contratos do front sem organização, upsert, cascade e NO ACTION';

-- Integridade independe de RLS e do trigger: service_role e SQL direto.
reset role;
select pg_temp.login(null, 'service_role');
set local role service_role;
select pg_temp.expect_error($s$update public.profiles set role_id = '00000000-0000-0000-0000-000000000011' where id = '00000000-0000-0000-0000-000000000106'$s$, '23503', 'FK profile A / papel B com service_role');
select pg_temp.expect_error($s$insert into public.role_permissions(role_id, organization_id, module_id) values ('00000000-0000-0000-0000-000000000011', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'm2')$s$, '23503', 'FK permissão A / papel B com service_role');
update public.profiles set role_id = '00000000-0000-0000-0000-000000000004' where id = '00000000-0000-0000-0000-000000000106';
select pg_temp.assert_true(public.can_manage_users_for('00000000-0000-0000-0000-000000000105') is true, 'helper service_role');
select pg_temp.expect_error($s$insert into public.role_permissions(role_id, module_id) values ('00000000-0000-0000-0000-000000000004', 'm2')$s$, '23502', 'service_role também informa organização da permissão');
select pg_temp.expect_error($s$update public.profiles set is_facilite_developer = true where id = '00000000-0000-0000-0000-000000000106'$s$, 'P0001', 'service_role não altera flag developer');
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.expect_error($s$update public.profiles set role_id = '00000000-0000-0000-0000-000000000011' where id = '00000000-0000-0000-0000-000000000106'$s$, '23503', 'FK também bloqueia SQL direto');
update public.profiles set role_id = null where id = '00000000-0000-0000-0000-000000000106';
select 'PASS FKs compostas sob SQL/service_role; provisionamento legítimo preservado';

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-000000000105');
update public.profiles set role_id = '00000000-0000-0000-0000-000000000003' where id = '00000000-0000-0000-0000-000000000106';
select pg_temp.assert_true((select role_id = '00000000-0000-0000-0000-000000000003' from public.profiles where id = '00000000-0000-0000-0000-000000000106'), 'gestor atribui próprio papel');
update public.profiles set role_id = null where id = '00000000-0000-0000-0000-000000000106';
select pg_temp.assert_true((select role_id is null from public.profiles where id = '00000000-0000-0000-0000-000000000106'), 'gestor remove papel');
select pg_temp.expect_error($s$update public.profiles set role_id = '00000000-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-000000000106'$s$, '42501', 'gestor não atribui Administrador');
select pg_temp.expect_error($s$update public.profiles set role_id = '00000000-0000-0000-0000-000000000004' where id = '00000000-0000-0000-0000-000000000106'$s$, '42501', 'gestor não atribui outro papel, mesmo sem flags');
select pg_temp.expect_error($s$update public.profiles set role_id = '00000000-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-000000000105'$s$, '42501', 'gestor não promove a si mesmo');
select pg_temp.expect_error($s$update public.profiles set role_id = '00000000-0000-0000-0000-000000000011' where id = '00000000-0000-0000-0000-000000000106'$s$, '42501', 'gestor não atribui papel estrangeiro');
with changed as (update public.roles set can_manage_permissions = true where id = '00000000-0000-0000-0000-000000000003' returning *)
select pg_temp.assert_true((select count(*) = 0 from changed), 'gestor não promove o próprio papel');
select 'PASS gestor de usuários só atribui o próprio papel ou NULL';

select pg_temp.login('00000000-0000-0000-0000-000000000101');
-- NULL não pode tornar a guarda do trigger permissiva para perfil sem papel.
select pg_temp.login('00000000-0000-0000-0000-000000000106');
select pg_temp.expect_error($s$update public.profiles set role_id = '00000000-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-000000000106'$s$, '42501', 'perfil sem papel não promove a si mesmo');
select pg_temp.login('00000000-0000-0000-0000-000000000101');
update public.profiles set role_id = '00000000-0000-0000-0000-000000000004' where id = '00000000-0000-0000-0000-000000000106';
select pg_temp.assert_true((select role_id = '00000000-0000-0000-0000-000000000004' from public.profiles where id = '00000000-0000-0000-0000-000000000106'), 'admin atribui outro papel local');
select pg_temp.expect_error($s$update public.profiles set role_id = '00000000-0000-0000-0000-000000000011' where id = '00000000-0000-0000-0000-000000000106'$s$, '23503', 'nem admin atribui estrangeiro');
select pg_temp.expect_error($s$update public.profiles set organization_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role_id = '00000000-0000-0000-0000-000000000011' where id = '00000000-0000-0000-0000-000000000101'$s$, 'P0001', 'proteção organization_id preservada');
select pg_temp.expect_error($s$update public.profiles set is_facilite_developer = true where id = '00000000-0000-0000-0000-000000000101'$s$, 'P0001', 'proteção developer preservada');
select pg_temp.login('00000000-0000-0000-0000-000000000104');
select pg_temp.expect_error($s$update public.profiles set role_id = null where id = '00000000-0000-0000-0000-000000000104'$s$, '42501', 'sem can_manage_users não altera papel');
select pg_temp.login('00000000-0000-0000-0000-000000000107');
select pg_temp.expect_error($s$update public.profiles set role_id = '00000000-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-000000000107'$s$, '42501', 'can_manage_permissions sozinho não substitui can_manage_users');
select pg_temp.login('00000000-0000-0000-0000-000000000108');
select pg_temp.assert_true(not coalesce(public.can_manage_users(), false) and not coalesce(public.has_permission('m1','view'), false), 'perfil inativo continua negado');
select pg_temp.expect_error($s$update public.profiles set role_id = null where id = '00000000-0000-0000-0000-000000000108'$s$, '42501', 'NULL do helper não permite editar papel');
select 'PASS admin, não gestor, gestor só de permissões, inativo e proteções MT3';

select pg_temp.login('00000000-0000-0000-0000-000000000109');
select pg_temp.assert_true((select count(*) = 2 from public.roles), 'B só lê seus dois papéis');
select pg_temp.assert_true(public.has_permission('only-b','view') is true and public.has_permission('m1','view') is false, 'B usa suas permissões, não as de A');
reset role;
select pg_temp.assert_true(public.current_role_max_discount_percent() = 90, 'teto do papel B');
select pg_temp.login('00000000-0000-0000-0000-000000000105');
select pg_temp.assert_true(public.current_role_max_discount_percent() = 10, 'teto do papel A');

-- Defesa em profundidade dos joins: dados corrompidos plantados apenas
-- neste SAVEPOINT, desabilitando as FKs compostas e revertendo tudo depois.
savepoint corrupt_fixture;
alter table public.profiles drop constraint profiles_role_id_organization_id_fkey;
alter table public.role_permissions drop constraint role_permissions_role_id_organization_id_fkey;
select set_config('request.jwt.claims', '', true);
update public.profiles set role_id = '00000000-0000-0000-0000-000000000011' where id = '00000000-0000-0000-0000-000000000101';
select pg_temp.login('00000000-0000-0000-0000-000000000101');
select pg_temp.assert_true(public.current_role_max_discount_percent() is null, 'teto rejeita papel com organização divergente');
select pg_temp.assert_true(not coalesce(public.can_manage_users_for('00000000-0000-0000-0000-000000000101'),false), 'users_for rejeita papel divergente');
set local role authenticated;
select pg_temp.assert_true(not coalesce(public.can_manage_users(),false) and not coalesce(public.can_manage_permissions(),false)
  and not coalesce(public.can_manage_branches(),false) and not coalesce(public.can_manage_modules(),false)
  and not coalesce(public.has_permission('only-b','view'),false), 'todos os helpers rejeitam papel divergente');
reset role;
select set_config('request.jwt.claims', '', true);
update public.profiles set role_id = '00000000-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-000000000101';
update public.role_permissions set organization_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where role_id = '00000000-0000-0000-0000-000000000001' and module_id = 'm1';
select pg_temp.login('00000000-0000-0000-0000-000000000101');
set local role authenticated;
select pg_temp.assert_true(not coalesce(public.has_permission('m1','view'),false), 'has_permission rejeita organização divergente em role_permissions');
rollback to corrupt_fixture;
select 'PASS joins explícitos dos 7 leitores mesmo com corrupção artificial sem FKs';

-- ACLs e superfície do Data API verificáveis sem conectar ao projeto real.
select pg_temp.assert_true((select count(*) = 7 and bool_and(prosecdef and provolatile = 's' and pg_get_userbyid(proowner) = 'postgres'
  and proconfig @> array['search_path=""'] and not has_function_privilege('anon', oid, 'EXECUTE'))
  from pg_proc where pronamespace = 'public'::regnamespace and proname in
  ('can_manage_users','can_manage_permissions','can_manage_branches','can_manage_modules','can_manage_users_for','has_permission','current_role_max_discount_percent')), '7 helpers STABLE SECURITY DEFINER, search_path vazio, anon revogado');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.can_manage_users_for(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.current_role_max_discount_percent()','EXECUTE')
  and not has_function_privilege('anon','public.prevent_role_escalation()','EXECUTE'), 'helpers internos preservam ACL');
select pg_temp.assert_true(to_regprocedure('public.current_organization_id()') is null
  and not has_schema_privilege('anon','private','USAGE')
  and not has_schema_privilege('authenticated','private','CREATE')
  and has_schema_privilege('authenticated','private','USAGE')
  and not has_function_privilege('anon','private.current_organization_id()','EXECUTE'), 'private permanece privado');
select pg_temp.assert_true((select count(*) = 3 and bool_and(prosecdef and provolatile = 's'
  and not has_function_privilege('anon',oid,'EXECUTE') and proconfig @> array['search_path=""'])
  from pg_proc where pronamespace = 'private'::regnamespace), '3 helpers privados da MT3 preservados');
select pg_temp.assert_true((select count(*) = 8 and bool_and(roles = array['authenticated']::name[]
  and (cmd = 'INSERT' or qual ~ 'SELECT.*current_organization_id')
  and (cmd not in ('INSERT','UPDATE') or with_check ~ 'SELECT.*current_organization_id')
  and (cmd in ('INSERT','SELECT') or qual ~ 'SELECT.*can_manage_permissions')
  and (cmd not in ('INSERT','UPDATE') or with_check ~ 'SELECT.*can_manage_permissions'))
  from pg_policies where schemaname = 'public' and tablename in ('roles','role_permissions')), '8 policies authenticated com subselects e WITH CHECK');
set local role anon;
select pg_temp.assert_true((select count(*) = 0 from public.roles) and (select count(*) = 0 from public.role_permissions), 'anon não lê papéis/permissões');
select pg_temp.expect_error('select public.can_manage_users()', '42501', 'anon não executa helper');
reset role;
select 'PASS ACLs e policies; private não foi movido/exposto';

create function pg_temp.assert_initplans(statement text, helpers text[]) returns void language plpgsql as $$
declare plan jsonb; initplans text; helper text;
begin
  execute 'explain (verbose, format json, costs off) ' || statement into plan;
  initplans := jsonb_path_query_array(plan, '$.** ? (@."Parent Relationship" == "InitPlan")')::text;
  foreach helper in array helpers loop
    perform pg_temp.assert_true(position(helper in initplans) > 0, 'InitPlan de ' || helper || ' em ' || statement);
  end loop;
end $$;
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-000000000101');
select pg_temp.assert_initplans('select * from public.roles', array['current_organization_id()']);
select pg_temp.assert_initplans('select * from public.role_permissions', array['current_organization_id()']);
select pg_temp.assert_initplans('update public.roles set description = description', array['can_manage_permissions()', 'current_organization_id()']);
select pg_temp.assert_initplans('update public.role_permissions set can_view = can_view', array['can_manage_permissions()', 'current_organization_id()']);
select pg_temp.assert_initplans('delete from public.roles', array['can_manage_permissions()', 'current_organization_id()']);
select pg_temp.assert_initplans('delete from public.role_permissions', array['can_manage_permissions()', 'current_organization_id()']);
reset role;
select set_config('request.jwt.claims', '', true);
select 'PASS EXPLAIN JSON como authenticated: helpers dentro dos InitPlans (SELECT/UPDATE/DELETE)';
