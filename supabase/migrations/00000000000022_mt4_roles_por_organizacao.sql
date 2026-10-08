-- MT4 (08/10/2026) — aplicada pela sessão de coordenação e verificada no projeto real.
-- Executar como uma transação (como o runner de migrations). O catálogo
-- modules continua global até MT7; aqui isolamos os papéis e suas permissões.

alter table public.roles
  add column if not exists organization_id uuid references public.organizations(id);

do $$
declare
  v_count bigint;
begin
  -- A guarda só deixa de ser necessária na reexecução APÓS o backfill e
  -- NOT NULL concluídos. Permite reexecutar inclusive após provisionar B.
  if not (select attnotnull from pg_catalog.pg_attribute
          where attrelid = 'public.roles'::regclass and attname = 'organization_id') then
    select count(*) into v_count from public.organizations;
    if v_count <> 1 then
      raise exception 'MT4: esperava exatamente 1 organização para o backfill de roles, encontrou %.', v_count;
    end if;
    update public.roles
    set organization_id = (select id from public.organizations)
    where organization_id is null;
  end if;
end $$;

alter table public.roles
  alter column organization_id set not null,
  alter column organization_id set default private.current_organization_id();

alter table public.role_permissions
  add column if not exists organization_id uuid references public.organizations(id);

update public.role_permissions rp
set organization_id = r.organization_id
from public.roles r
where r.id = rp.role_id and rp.organization_id is null;

do $$
begin
  if exists (select 1 from public.role_permissions where organization_id is null) then
    raise exception 'MT4: role_permissions sem organização após o backfill.';
  end if;
end $$;

alter table public.role_permissions
  alter column organization_id set not null,
  alter column organization_id set default private.current_organization_id();

alter table public.roles drop constraint if exists roles_name_key;
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                 where conrelid = 'public.roles'::regclass and conname = 'roles_organization_id_name_key') then
    alter table public.roles add constraint roles_organization_id_name_key unique (organization_id, name);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
                 where conrelid = 'public.roles'::regclass and conname = 'roles_id_organization_id_key') then
    alter table public.roles add constraint roles_id_organization_id_key unique (id, organization_id);
  end if;
end $$;

-- Uma única relação profiles -> roles também evita ambiguidade no embed
-- PostgREST roles(name). NO ACTION preserva o bloqueio de exclusão em uso.
-- A relação das permissões mantém ON DELETE CASCADE. MATCH SIMPLE permite
-- profiles.role_id NULL, mas organization_id continua obrigatório.
alter table public.profiles drop constraint if exists profiles_role_id_fkey;
alter table public.role_permissions drop constraint if exists role_permissions_role_id_fkey;
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                 where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_id_organization_id_fkey') then
    alter table public.profiles add constraint profiles_role_id_organization_id_fkey
      foreign key (role_id, organization_id) references public.roles (id, organization_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
                 where conrelid = 'public.role_permissions'::regclass and conname = 'role_permissions_role_id_organization_id_fkey') then
    alter table public.role_permissions add constraint role_permissions_role_id_organization_id_fkey
      foreign key (role_id, organization_id) references public.roles (id, organization_id) on delete cascade;
  end if;
end $$;

-- As FKs compostas precisam de índices com as duas colunas na tabela filha.
-- Os índices antigos só por role_id ajudam buscas comuns, mas não cobrem a
-- constraint inteira segundo o advisor de performance do Supabase.
create index if not exists profiles_role_id_organization_id_idx
  on public.profiles (role_id, organization_id);

create index if not exists role_permissions_role_id_organization_id_idx
  on public.role_permissions (role_id, organization_id);

create index if not exists role_permissions_organization_id_idx
  on public.role_permissions (organization_id);

-- SECURITY DEFINER evita recursão de RLS em profiles/roles. Preservamos
-- assinaturas, STABLE, active e o resultado NULL quando não há perfil/papel.
create or replace function public.can_manage_permissions() returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(r.can_manage_permissions, false)
  from public.profiles p
  join public.roles r on r.id = p.role_id and r.organization_id = p.organization_id
  where p.id = (select auth.uid()) and p.active = true;
$$;

create or replace function public.can_manage_users() returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(r.can_manage_users, false)
  from public.profiles p
  join public.roles r on r.id = p.role_id and r.organization_id = p.organization_id
  where p.id = (select auth.uid()) and p.active = true;
$$;

-- Usada somente por service_role na Edge Function. Não compara com auth.uid:
-- esta chamada privilegiada verifica o usuário cujo JWT a borda já validou.
create or replace function public.can_manage_users_for(p_user_id uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(r.can_manage_users, false)
  from public.profiles p
  join public.roles r on r.id = p.role_id and r.organization_id = p.organization_id
  where p.id = p_user_id and p.active = true;
$$;

create or replace function public.can_manage_branches() returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(r.can_manage_branches, false)
  from public.profiles p
  join public.roles r on r.id = p.role_id and r.organization_id = p.organization_id
  where p.id = (select auth.uid()) and p.active = true;
$$;

create or replace function public.can_manage_modules() returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(r.can_manage_modules, false)
  from public.profiles p
  join public.roles r on r.id = p.role_id and r.organization_id = p.organization_id
  where p.id = (select auth.uid()) and p.active = true;
$$;

create or replace function public.has_permission(p_module_id text, p_action text) returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(
    case p_action
      when 'view' then rp.can_view
      when 'create' then rp.can_create
      when 'edit' then rp.can_edit
      when 'delete' then rp.can_delete
      else false
    end, false)
  from public.profiles p
  join public.roles r on r.id = p.role_id and r.organization_id = p.organization_id
  join public.role_permissions rp
    on rp.role_id = r.id and rp.module_id = p_module_id
   and rp.organization_id = r.organization_id and rp.organization_id = p.organization_id
  where p.id = (select auth.uid()) and p.active = true;
$$;

create or replace function public.current_role_max_discount_percent() returns numeric
language sql stable security definer set search_path to '' as $$
  select r.max_discount_percent
  from public.profiles p
  join public.roles r on r.id = p.role_id and r.organization_id = p.organization_id
  where p.id = (select auth.uid()) and p.active = true;
$$;

-- Porta de edição direta de profiles.role_id (inclusive via PostgREST).
-- O dropdown não é fronteira de segurança. A Edge faz sua própria validação,
-- pois usa service_role. SQL administrativo mantém o comportamento anterior.
create or replace function public.prevent_role_escalation() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_caller_role_id uuid;
begin
  if new.role_id is distinct from old.role_id and auth.role() <> 'service_role' then
    -- COALESCE é necessário: sem perfil/papel os helpers retornam NULL.
    if not coalesce(public.can_manage_users(), false) then
      raise exception 'Não autorizado a alterar o papel de acesso.' using errcode = '42501';
    end if;
    if new.role_id is not null and not coalesce(public.can_manage_permissions(), false) then
      select p.role_id into v_caller_role_id
      from public.profiles p
      join public.roles r on r.id = p.role_id and r.organization_id = p.organization_id
      where p.id = (select auth.uid()) and p.active = true;
      if new.role_id is distinct from v_caller_role_id then
        raise exception 'Você só pode atribuir seu próprio papel ou remover o papel.' using errcode = '42501';
      end if;
    end if;
  end if;

  -- Proteções MT3 e de desenvolvedor preservadas.
  if new.organization_id is distinct from old.organization_id
     and auth.role() <> 'service_role' then
    raise exception 'Não autorizado a alterar a organização de um usuário.';
  end if;
  if new.is_facilite_developer is distinct from old.is_facilite_developer
     and auth.role() is not null then
    raise exception 'is_facilite_developer só pode ser alterado por SQL direto no banco.';
  end if;
  return new;
end;
$$;

-- CREATE OR REPLACE preserva ACLs; explicitamos a superfície intencional.
revoke all on function public.can_manage_permissions(), public.can_manage_users(),
  public.can_manage_branches(), public.can_manage_modules(), public.has_permission(text, text)
  from public, anon;
grant execute on function public.can_manage_permissions(), public.can_manage_users(),
  public.can_manage_branches(), public.can_manage_modules(), public.has_permission(text, text)
  to authenticated, service_role;
revoke all on function public.can_manage_users_for(uuid), public.prevent_role_escalation(),
  public.current_role_max_discount_percent() from public, anon, authenticated;
grant execute on function public.can_manage_users_for(uuid), public.prevent_role_escalation()
  to service_role;
-- current_role_max_discount_percent mantém sua ACL interna anterior.
-- private e os schemas expostos não mudam nesta migration.

alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;

drop policy if exists "read roles" on public.roles;
create policy "read roles" on public.roles for select to authenticated
  using (organization_id = (select private.current_organization_id()));
drop policy if exists "manage roles insert" on public.roles;
create policy "manage roles insert" on public.roles for insert to authenticated
  with check ((select public.can_manage_permissions()) and organization_id = (select private.current_organization_id()));
drop policy if exists "manage roles update" on public.roles;
create policy "manage roles update" on public.roles for update to authenticated
  using ((select public.can_manage_permissions()) and organization_id = (select private.current_organization_id()))
  with check ((select public.can_manage_permissions()) and organization_id = (select private.current_organization_id()));
drop policy if exists "manage roles delete" on public.roles;
create policy "manage roles delete" on public.roles for delete to authenticated
  using ((select public.can_manage_permissions()) and organization_id = (select private.current_organization_id()));

drop policy if exists "read role_permissions" on public.role_permissions;
create policy "read role_permissions" on public.role_permissions for select to authenticated
  using (organization_id = (select private.current_organization_id()));
drop policy if exists "manage role_permissions insert" on public.role_permissions;
create policy "manage role_permissions insert" on public.role_permissions for insert to authenticated
  with check ((select public.can_manage_permissions()) and organization_id = (select private.current_organization_id()));
drop policy if exists "manage role_permissions update" on public.role_permissions;
create policy "manage role_permissions update" on public.role_permissions for update to authenticated
  using ((select public.can_manage_permissions()) and organization_id = (select private.current_organization_id()))
  with check ((select public.can_manage_permissions()) and organization_id = (select private.current_organization_id()));
drop policy if exists "manage role_permissions delete" on public.role_permissions;
create policy "manage role_permissions delete" on public.role_permissions for delete to authenticated
  using ((select public.can_manage_permissions()) and organization_id = (select private.current_organization_id()));
