-- MT1 — a organização existe: tabela `organizations` e `branches.organization_id`
-- (11/09/2026)
--
-- **Esta migration foi escrita e NÃO foi aplicada.** A sessão que a escreveu
-- não tinha autorização para aplicar migration nem para fazer deploy, pela
-- mesma regra de D1, A11, D3 e E4.
--
-- Diferente de toda migration anterior deste diretório, esta não pertence ao
-- plano "Mínimo pra vender" — é a primeira tarefa de
-- `facilite-multi-tenant-saas.md` (Etapa 1, MT1), um plano separado sobre
-- converter o banco de um projeto Supabase por cliente para vários clientes
-- convivendo num projeto só. Ver aquele arquivo para o raciocínio completo
-- por trás da migração; aqui só a fundação de dado.
--
-- ## Escopo desta tarefa, e o que ela deliberadamente não faz
--
-- MT1 é só a coluna e a tabela. **Nenhuma RLS existente muda, nenhuma
-- função muda, nenhuma tela muda.** (A tabela nova, `organizations`, liga
-- RLS própria e sem policy nenhuma — seção 1b abaixo; isso é "toda tabela
-- nova nasce trancada", não uma regra de isolamento por organização, que
-- continua sendo MT3.) Em particular:
--
--   * `has_branch_access` e `has_permission` continuam exatamente como
--     estão — ligá-las a `organization_id` é MT3, tarefa futura;
--   * `can_manage_branches()` (e, quase certo, `can_manage_users()`,
--     `can_manage_permissions()`, `can_manage_modules()`) hoje é um flag de
--     papel puro (`roles.can_manage_branches`), sem checar filial nem
--     organização nenhuma. Isso sustenta as policies `manage branches
--     insert/update/delete` e metade de `read accessible branches`. Assim
--     que existir uma segunda organização de verdade, um admin da
--     Organização A consegue mexer em filial da Organização B através
--     dessas policies — até essa família de funções ser corrigida em MT3.
--     Registrado no plano (`facilite-multi-tenant-saas.md`, achado de MT1
--     que amplia MT3). Não é um bug desta migration: é o motivo pelo qual
--     nenhuma tela nova de gestão de filial multi-organização pode abrir
--     para uso antes de MT3 fechar — a coluna sozinha não fecha isolamento,
--     e não deveria;
--   * `profiles.organization_id` é MT2, não aqui;
--   * `roles`, `contacts`, `tax_groups`/`tax_rules` e `modules` continuam
--     globais por engano — é a Etapa 2 (MT4-MT7).
--
-- ## Por que dá para adicionar `organization_id` como `not null` direto
--
-- Não existe hoje nenhuma filial que deva ficar "sem organização" — só uma
-- filial em produção (`Supermercado No Ponto Centro`), e qualquer outra que
-- exista aponta para a mesma empresa. Uma coluna nullable-por-enquanto só
-- adiaria o problema real (alguma RPC nova esquecer de filtrar por ela) sem
-- necessidade. A ordem dentro desta migration importa e é proposital: a
-- coluna nasce nullable, o backfill roda, e só depois `set not null` —
-- tudo na mesma transação da migration (o runner da Supabase aplica cada
-- arquivo como uma transação só), então não existe uma janela em que a
-- constraint valeria antes do backfill terminar.

-- ---------------------------------------------------------------------
-- 1. A tabela `organizations`
-- ---------------------------------------------------------------------
--
-- `document` (CNPJ da matriz) é nullable: nem toda organização precisa ter
-- um CNPJ único definido já no nascimento (o provisionamento de MT9, por
-- exemplo, pode criar a organização antes do cadastro fiscal da filial
-- estar completo), e exigir aqui seria antecipar uma regra que nenhuma
-- tarefa deste plano pediu ainda.
--
-- `active boolean not null default true`: decidi incluir agora, e não
-- adiar. Duas razões: (1) é o mesmo padrão que `branches.active` já usa
-- nesta base — não é convenção nova; (2) MT13 (Etapa 6, "suspender
-- licença") vai precisar de exatamente este campo, e diferente do caso que
-- D1 recusou (uma coluna de série fiscal que nenhum código respeitaria,
-- criando divergência silenciosa entre repositório e produção), uma coluna
-- `active` parada em `true` não finge nenhum comportamento que não existe:
-- nenhuma RLS lê esta coluna ainda, e nenhuma tela promete suspensão. É
-- cadastro puro, como `branches.email_copia_nota_fiscal` em D1.

create table if not exists public.organizations (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  document text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.organizations is
  'Camada de isolamento acima de filial — uma organização (empresa cliente do Facilite) agrupa uma ou mais branches. Nasceu em MT1 (11/09/2026, ver facilite-multi-tenant-saas.md), a primeira tarefa do plano de migração multi-tenant. Nesta etapa a tabela existe e branches aponta para ela, mas nenhuma RLS ainda confere organization_id — isso é MT3. document é o CNPJ da matriz, nullable de propósito (nem toda organização nasce com cadastro fiscal completo). active é cadastro puro por enquanto: nenhum código lê esta coluna ainda, ela existe pronta para MT13 (suspender licença).';

comment on column public.organizations.document is
  'CNPJ da matriz da organização. Nullable: uma organização pode nascer (MT9, provisionamento) antes do cadastro fiscal da primeira filial estar completo.';

comment on column public.organizations.active is
  'Reservada para MT13 (Etapa 6 de facilite-multi-tenant-saas.md — suspender licença sem apagar dado). Nenhuma RLS ou RPC confere este campo ainda: todo registro nasce true e nada aqui muda comportamento nesta tarefa.';

-- ---------------------------------------------------------------------
-- 1b. RLS — a tabela nasce trancada, sem nenhuma policy
-- ---------------------------------------------------------------------
--
-- "Não mexa em RLS" (o escopo desta tarefa) vale para as funções e
-- policies que já existem — `has_branch_access`, `can_manage_branches` e
-- tudo que depende delas continuam intocados, é MT3 quem decide como
-- organização entra na regra de acesso. Mas isso não é motivo para uma
-- tabela **nova** nascer sem RLS nenhuma: toda tabela criada desde que
-- este projeto ganhou migrations versionadas (`mva_rules` em B2,
-- `fiscal_numbering` em A10, `fiscal_queue` em A7) liga
-- `enable row level security` no mesmo bloco que a cria — nenhuma delas
-- ficou pendente para uma tarefa futura "arrumar depois". `organizations`
-- segue a mesma regra: RLS ligada, zero policy. Sem nenhuma policy
-- permissiva, `anon` e `authenticated` não leem nem escrevem nada aqui
-- nem com GRANT de tabela concedido — é o próprio mecanismo do Postgres,
-- não uma policy "deny all" escrita à mão. `service_role` continua
-- passando por cima disso, como já faz em todo o resto do banco (é o
-- mesmo padrão que a Edge Function `admin-users` já usa).
--
-- O `revoke` abaixo é defesa em profundidade sobre a mesma tabela — mesmo
-- padrão de `fiscal_numbering` (A10): tira o GRANT de tabela que a
-- Supabase concede a `anon`/`authenticated` por padrão em toda tabela
-- nova de `public`, para que o acesso a `organizations` não dependa só da
-- RLS estar ligada.
--
-- Quando MT3 (ou uma tarefa de tela própria, mais adiante) decidir a
-- policy real, ela entra numa migration nova — esta aqui não presume qual
-- vai ser.

alter table public.organizations enable row level security;

revoke all on table public.organizations from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. `branches.organization_id` — nasce nullable, de propósito
-- ---------------------------------------------------------------------
--
-- A ordem das próximas três seções importa: a coluna precisa existir
-- (nullable) antes de qualquer `update` conseguir escrever nela, e só
-- depois do backfill preencher toda linha é que `set not null` pode
-- entrar em vigor. As três seções rodam na mesma transação implícita desta
-- migration (o runner da Supabase aplica cada arquivo como uma transação
-- só), então não existe uma janela em que a constraint valeria antes do
-- backfill terminar — mas a ordem textual abaixo ainda precisa ser esta.

alter table public.branches
  add column if not exists organization_id uuid references public.organizations(id);

-- ---------------------------------------------------------------------
-- 3. Backfill: a organização que já existe, sob outro nome
-- ---------------------------------------------------------------------
--
-- Pesquisado antes de escrever: este banco não tem nenhum cadastro de
-- "razão social" ou "nome da empresa" separado de filial — `profiles` não
-- tem coluna do tipo, não existe tabela de configuração/organização, e
-- `fiscal_documents.emitente_nome`/`emitente_nome_fantasia` estão nulos
-- (nenhuma nota emitida ainda tem esse snapshot preenchido). O único nome
-- de empresa cadastrado em qualquer lugar do sistema é
-- `branches.name = 'Supermercado No Ponto Centro'`, a única filial em
-- produção — por isso a organização de backfill nasce com este nome, e não
-- um genérico como "Organização Principal": é o nome real que o próprio
-- sistema já tinha.
--
-- `document` fica nulo no backfill — o template desta tarefa (ver o
-- prompt) pede só `insert into organizations (name) values (...)`, e
-- assumir que o CNPJ da organização é o mesmo `branches.cnpj` da matriz
-- seria uma equivalência que nenhuma tarefa deste plano define ainda
-- (MT9, provisionamento, é quem vai decidir como aquele campo se preenche
-- para organização nova). Fica para quem cadastrar a organização via UI,
-- quando essa tela existir.

do $$
declare
  v_organization_id uuid;
begin
  insert into public.organizations (name)
  values ('Supermercado No Ponto Centro')
  returning id into v_organization_id;

  update public.branches
  set organization_id = v_organization_id
  where organization_id is null;
end
$$;

-- ---------------------------------------------------------------------
-- 4. `not null` — só depois de toda linha estar preenchida
-- ---------------------------------------------------------------------

alter table public.branches
  alter column organization_id set not null;

comment on column public.branches.organization_id is
  'Organização (empresa cliente do Facilite) dona desta filial — MT1, 11/09/2026, ver facilite-multi-tenant-saas.md. NOT NULL desde a criação: toda filial pertence a exatamente uma organização, sem estado transitório "sem organização". Nenhuma RLS confere esta coluna ainda (MT3, tarefa futura) — has_branch_access e can_manage_branches continuam sem checar organização até lá.';

create index if not exists branches_organization_id_idx
  on public.branches (organization_id);

-- ---------------------------------------------------------------------
-- O que esta migration deliberadamente NÃO faz
-- ---------------------------------------------------------------------
--
--   * **Não mexe na RLS existente.** `has_branch_access`, `has_permission`,
--     `can_manage_branches` e todas as policies que dependem delas
--     continuam bit a bit como estavam. É MT3. (A RLS que esta migration
--     liga é só a de `organizations`, tabela nova — seção 1b — e nasce sem
--     nenhuma policy, não com isolamento por organização.)
--   * **Não mexe em `profiles`.** `profiles.organization_id` é MT2.
--   * **Não mexe em `roles`, `contacts`, `tax_groups`/`tax_rules` nem
--     `modules`.** Continuam globais por engano — Etapa 2 do plano
--     (MT4-MT7), de propósito fora desta tarefa.
--   * **Não abre nenhuma tela nova**, nem muda nenhuma tela existente — o
--     front-end não lê nem grava `organization_id` em lugar nenhum hoje
--     (conferido: nenhuma ocorrência em `src/`), e continua assim até uma
--     tarefa futura precisar.
--   * **Não corrige `can_manage_branches()` e a família correlata.** O
--     achado de que elas não checam organização está registrado no plano
--     e é escopo de MT3, não desta migration — ver a seção 1 acima.
