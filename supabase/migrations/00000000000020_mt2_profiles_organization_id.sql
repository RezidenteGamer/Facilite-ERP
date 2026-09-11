-- MT2 — profiles.organization_id (11/09/2026)
--
-- **Esta migration foi escrita e NÃO foi aplicada.** A sessão que a escreveu
-- não tinha autorização para aplicar migration nem para fazer deploy, pela
-- mesma regra de D1, A11, D3, E4 e MT1.
--
-- Segunda tarefa da Etapa 1 de `facilite-multi-tenant-saas.md` (MT2). MT1
-- (`00000000000019_mt1_organizations.sql`) criou `organizations` e
-- `branches.organization_id`; esta migration faz o mesmo tipo de coluna em
-- `profiles` — um usuário pertence a exatamente uma organização. Ver aquele
-- arquivo para o raciocínio completo por trás do plano; aqui só a fundação
-- de dado para `profiles`. A parte de código de aplicação (a Edge Function
-- `admin-users`, que passa a preencher esta coluna ao criar um usuário) está
-- fora desta migration, em `supabase/functions/admin-users/index.ts`.
--
-- ## Escopo desta tarefa, e o que ela deliberadamente não faz
--
-- Mesma disciplina de MT1: só a coluna. **Nenhuma RLS muda, nenhuma função
-- de autorização muda, nenhuma tela muda.** Em particular:
--
--   * `has_branch_access`, `has_permission`, `can_manage_branches()` e toda
--     a família `can_manage_*` (incluindo `can_manage_users_for`, usada por
--     `admin-users`) continuam exatamente como estão — ligá-las a
--     `organization_id` é MT3, tarefa futura. `can_manage_users_for` hoje é
--     um flag de papel puro (`roles.can_manage_users`), sem checar
--     organização — achado já registrado no plano (seção de MT3) antes
--     desta migration ser escrita, não descoberto aqui;
--   * `roles`, `contacts`, `tax_groups`/`tax_rules` e `modules` continuam
--     globais por engano — Etapa 2 (MT4-MT7);
--   * nenhuma tela nova, nenhuma mudança de tela existente. Confirmado:
--     `organization_id`/`organizationId` não aparece em `src/` hoje, e
--     `adminUsersApi.ts` (única chamadora de `admin-users` no front-end)
--     não manda esse campo — continua não mandando depois desta tarefa, a
--     resolução do valor é inteiramente do servidor.
--
-- ## Por que dá para adicionar `organization_id` como `not null` direto
--
-- Mesma ordem de MT1, pela mesma razão: a coluna nasce nullable, o backfill
-- roda, e só depois `set not null` — tudo dentro da mesma transação desta
-- migration (o runner da Supabase aplica cada arquivo como uma transação
-- só), então não existe uma janela em que a constraint valeria antes do
-- backfill terminar.
--
-- ## A decisão de backfill: abortar se `organizations` não tiver exatamente
-- uma linha, em vez de adivinhar
--
-- Hoje existe exatamente uma organização (criada pelo próprio backfill de
-- MT1) e todo `profiles` existente pertence a ela — sem ambiguidade
-- nenhuma, mesmo raciocínio de MT1. A diferença para MT1: aquela migration
-- criava a organização e preenchia `branches` na mesma transação, então não
-- havia como o pressuposto "existe uma organização só" falhar. Esta
-- migration roda depois, sobre uma tabela `organizations` que já existe de
-- verdade — em teoria alguém poderia ter inserido uma segunda linha entre
-- MT1 e MT2 (manualmente, fora deste plano). Se isso tiver acontecido, não
-- existe backfill correto e automático: `profiles` não guarda `branch_id`
-- (é `user_branches`, tabela N:N, quem liga usuário a filial, e só filial
-- tem `organization_id` hoje), então um usuário ligado a filiais de
-- organizações diferentes — ou a nenhuma filial ainda — não tem uma
-- resposta única sobre "qual organização". Adivinhar (ex.: sempre a
-- primeira organização por `created_at`) esconderia esse problema em vez de
-- expor. Por isso o `do $$ ... $$` abaixo confere a contagem antes de
-- escrever qualquer coisa e levanta uma exceção com mensagem clara se não
-- for exatamente uma — falha alto e cedo, sem aplicar a migration pela
-- metade (a checagem roda antes do `alter table ... add column`, então uma
-- falha aqui não deixa a tabela em estado intermediário).

-- ---------------------------------------------------------------------
-- 0. Guarda: aborta se `organizations` não tiver exatamente uma linha
-- ---------------------------------------------------------------------

do $$
declare
  v_organization_count int;
begin
  select count(*) into v_organization_count from public.organizations;

  if v_organization_count <> 1 then
    raise exception
      'MT2: esperava exatamente 1 linha em organizations para backfill sem ambiguidade, encontrou %. profiles não guarda branch_id (é user_branches, N:N), então não há como derivar organization_id automaticamente com mais de uma organização — esta migration precisa ser revisada antes de rodar neste banco.',
      v_organization_count;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. `profiles.organization_id` — nasce nullable, de propósito
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists organization_id uuid references public.organizations(id);

-- ---------------------------------------------------------------------
-- 2. Backfill: todo profile existente pertence à organização única
-- ---------------------------------------------------------------------

update public.profiles
set organization_id = (select id from public.organizations limit 1)
where organization_id is null;

-- ---------------------------------------------------------------------
-- 3. `not null` — só depois de toda linha estar preenchida
-- ---------------------------------------------------------------------

alter table public.profiles
  alter column organization_id set not null;

comment on column public.profiles.organization_id is
  'Organização (empresa cliente do Facilite) à qual este usuário pertence — MT2, 11/09/2026, ver facilite-multi-tenant-saas.md. NOT NULL desde a criação: todo usuário pertence a exatamente uma organização, sem estado transitório "sem organização". Preenchida por supabase/functions/admin-users/index.ts na criação (herdada do organization_id do perfil de quem cria, ou da organização única no caminho de bootstrap). Nenhuma RLS confere esta coluna ainda (MT3, tarefa futura) — has_branch_access, has_permission e can_manage_users_for continuam sem checar organização até lá.';

create index if not exists profiles_organization_id_idx
  on public.profiles (organization_id);

-- ---------------------------------------------------------------------
-- O que esta migration deliberadamente NÃO faz
-- ---------------------------------------------------------------------
--
--   * **Não mexe na RLS existente.** `has_branch_access`, `has_permission`,
--     `can_manage_users_for` e todas as policies que dependem delas
--     continuam bit a bit como estavam. É MT3.
--   * **Não mexe em `roles`, `contacts`, `tax_groups`/`tax_rules` nem
--     `modules`.** Continuam globais por engano — Etapa 2 (MT4-MT7).
--   * **Não constrói MT9** (uma organização nova nascer sozinha). O
--     caminho de bootstrap de `admin-users` (ver o comentário no próprio
--     arquivo) continua só funcionando enquanto existir uma organização
--     só — é uma ponte estreita para esta etapa, não uma solução.
--   * **Não abre nenhuma tela nova**, nem muda nenhuma tela existente — o
--     front-end não lê nem grava `organization_id` em lugar nenhum hoje, e
--     continua assim: a resolução do valor é inteiramente do servidor.
