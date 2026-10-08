-- Conferência adicional da rodada corretiva MT3. Rodar APÓS a migration,
-- como postgres, em uma sessão única. Não é migration; não escreve dados.
-- EXPLAIN VERBOSE mostra os nomes das funções nos Result dos InitPlan.
-- STABLE não significa execução única; cada InitPlan não correlacionado
-- executa no máximo uma vez por execução de seu plano, quando necessário.
begin;
do $$
declare
  f record;
begin
  for f in
    select p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in
      ('current_organization_id', 'branch_in_current_organization', 'user_in_current_organization')
  loop
    if not f.prosecdef or f.provolatile <> 's'
       or not coalesce(f.proconfig @> array['search_path=""'], false)
       or pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE')
       or not pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', f.oid, 'EXECUTE') then
      raise exception 'Helper com configuração/ACL inválida: %', f.proname;
    end if;
  end loop;
  if (select count(*) from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname in
        ('current_organization_id', 'branch_in_current_organization', 'user_in_current_organization')) <> 3
     or pg_catalog.to_regprocedure('public.current_organization_id()') is not null
     or pg_catalog.to_regprocedure('public.branch_in_current_organization(uuid)') is not null
     or pg_catalog.to_regprocedure('public.user_in_current_organization(uuid)') is not null
     or pg_catalog.to_regprocedure('public.has_branch_access(uuid)') is null then
    raise exception 'Localização dos helpers incorreta';
  end if;
  if pg_catalog.has_schema_privilege('anon', 'private', 'USAGE')
     or pg_catalog.has_schema_privilege('authenticated', 'private', 'CREATE')
     or pg_catalog.has_schema_privilege('service_role', 'private', 'CREATE')
     or not pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE')
     or not pg_catalog.has_schema_privilege('service_role', 'private', 'USAGE') then
    raise exception 'ACL do schema private incorreta';
  end if;
  raise notice 'Helpers: localização, STABLE, SECURITY DEFINER, search_path e ACLs OK';
end $$;

select pg_catalog.set_config('request.jwt.claims',
  (select pg_catalog.json_build_object('sub', p.id, 'role', 'authenticated')::text
   from public.profiles p join public.roles r on r.id = p.role_id
   where p.active and r.can_manage_users and r.can_manage_branches limit 1), true);
set local role authenticated;

-- Esperado: can_manage_branches e private.current_organization_id em InitPlan.
explain (verbose, costs off) select id from public.branches;
-- Esperado: auth.uid, can_manage_users e private.current_organization_id em InitPlan.
explain (verbose, costs off) select id from public.profiles;
-- Esperado: can_manage_branches em InitPlan; helper com branch_id no Filter.
explain (verbose, costs off) select user_id, branch_id from public.user_branches;
rollback;
