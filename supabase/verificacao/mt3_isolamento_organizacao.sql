-- MT3 — script de conferência manual do isolamento por organização
-- (11/09/2026, ver `facilite-multi-tenant-saas.md`)
--
-- ## O que este arquivo é, e o que ele NÃO é
--
-- **Não é uma migration.** Mora fora de `supabase/migrations/` de propósito:
-- o runner da Supabase aplica tudo que está lá, e este script escreve e
-- apaga dado de teste — não pode entrar no histórico de migration de jeito
-- nenhum. Nada aqui é aplicado automaticamente, por nenhum caminho.
--
-- **Não é MT8.** A bateria de isolamento entre organizações de verdade —
-- automatizada, rodando no `npm test`, cobrindo as quatro famílias de tabela
-- da Etapa 2 e as 13 branch-scoped — é a Etapa 3 do plano, tarefa própria.
-- Este script é um atalho: torna a conferência manual de quem aplicar a
-- migration `00000000000021_mt3_organizacao_nas_funcoes_de_autorizacao.sql`
-- mais rápida e mais completa do que ela seria improvisada na hora. Passar
-- aqui **não** autoriza colocar uma segunda organização real neste banco:
-- `roles`, `role_permissions`, `contacts`, `tax_groups`/`tax_rules` e
-- `modules` continuam globais até a Etapa 2 fechar.
--
-- ## Como rodar
--
-- Rode as três PARTES **na ordem**, no SQL editor da Supabase (ou por
-- `execute_sql`), com privilégio de `postgres`. As PARTES 1 e 2 param no
-- primeiro erro — é o comportamento desejado: cada `FALHOU` é uma exceção
-- com mensagem dizendo exatamente qual checagem reprovou.
--
-- **A PARTE 3 (limpeza) deve ser rodada SEMPRE**, inclusive — e
-- principalmente — quando a PARTE 2 falhar no meio. Ela é idempotente e
-- independente do resto: apaga por id fixo, roda quantas vezes for preciso,
-- e a primeira coisa que faz é devolver a sessão ao papel `postgres` (a
-- PARTE 2 a deixa como `authenticated`, e um erro no meio dela não desfaz
-- isso sozinho).
--
-- ## Por que ids fixos, e não `gen_random_uuid()`
--
-- Os cinco registros do preparo (uma organização, duas filiais, dois
-- usuários) nascem com uuid literal, prefixo `d3...` — de "D3" = MT3. Assim
-- a PARTE 3 apaga exatamente eles sem depender de nenhuma variável de sessão
-- ter sobrevivido a um erro, e a PARTE 1 pode começar limpando restos de uma
-- execução anterior que tenha morrido no meio. Nenhum uuid de produção se
-- deve usar estes IDs reservados. As checagens 7 e 12 usam ainda os IDs 006/007.
--
-- ## O que ele exige que já exista no banco
--
-- Um papel (`roles`) com `can_manage_users` E `can_manage_branches` — o
-- "Administrador" que este banco já tem — e ao menos uma filial. Se faltar
-- qualquer um dos dois, a PARTE 1 aborta dizendo qual — não adivinha nem
-- cria.
--
-- ## O script não escreve NADA em cima de linha de produção
--
-- Nem o "atacante" é um usuário real: a PARTE 1 cria um usuário temporário
-- próprio na organização 1, com o mesmo `role_id` do administrador de
-- verdade. Assim o teste exercita a configuração de papel real (é o poder
-- daquele papel que está sendo medido) sem escrever uma única linha que
-- referencie um usuário de produção — em particular, sem plantar o vínculo
-- cruzado da seção 1.2b na conta de alguém que usa o sistema.
--
-- Tudo que este script escreve, ele cria do zero e apaga na PARTE 3. As
-- únicas linhas preexistentes que ele toca são de **leitura**: o papel de
-- administrador e a primeira filial, para saber com o que comparar.


-- =====================================================================
-- PARTE 1 — preparo (rodar como `postgres`)
-- =====================================================================

do $$
declare
  v_org2      constant uuid := 'd3000000-0000-4000-8000-000000000001';
  v_branch2   constant uuid := 'd3000000-0000-4000-8000-000000000002';
  v_user2     constant uuid := 'd3000000-0000-4000-8000-000000000003';
  v_branch3   constant uuid := 'd3000000-0000-4000-8000-000000000004';
  v_admin     constant uuid := 'd3000000-0000-4000-8000-000000000005';
  v_role      uuid;
  v_org1      uuid;
  v_branch1   uuid;
begin
  -- 1.0 — resto de execução anterior que tenha morrido no meio
  delete from auth.users where id in (v_user2, v_admin);
  delete from public.branches where id in (v_branch2, v_branch3,
    'd3000000-0000-4000-8000-000000000006', 'd3000000-0000-4000-8000-000000000007');
  delete from public.organizations where id = v_org2;

  -- 1.1 — o papel e a filial reais contra os quais tudo será medido
  --
  -- Leitura pura: nada aqui é alterado. O papel é o mesmo "Administrador"
  -- que o banco já usa — é o poder desse papel que está sendo testado, então
  -- copiá-lo é o ponto; inventar um papel novo com as flags ligadas testaria
  -- uma configuração que não é a de produção.
  select r.id into v_role
  from public.roles r
  where r.can_manage_users and r.can_manage_branches
  order by r.name
  limit 1;

  if v_role is null then
    raise exception
      'PREPARO: não encontrei nenhum papel em `roles` com can_manage_users E can_manage_branches ao mesmo tempo. O script precisa desse papel — é o excesso de poder dele que está sendo medido.';
  end if;

  select b.id, b.organization_id into v_branch1, v_org1
  from public.branches b
  where b.active
  order by b.code
  limit 1;

  if v_branch1 is null then
    raise exception
      'PREPARO: não encontrei nenhuma filial ativa em `branches`. O script precisa de ao menos uma, para ter contra o que comparar a filial da organização 2.';
  end if;

  -- 1.2 — a segunda organização e a segunda filial, temporárias
  --
  -- `organization_id` vai explícito no insert de `branches`: o default que a
  -- migration criou resolve `private.current_organization_id()`, que é NULL em SQL
  -- direto (não há `auth.uid()`). É o comportamento correto e documentado —
  -- provisionamento diz em qual organização está criando, não herda.
  insert into public.organizations (id, name, document)
  values (v_org2, 'MT3 VERIFICACAO — organização temporária', null);

  insert into public.branches (id, code, name, organization_id)
  values (v_branch2, 'MT3VERIF', 'MT3 VERIFICACAO — filial temporária', v_org2);

  -- 1.2b — a filial "envenenada"
  --
  -- Existe uma segunda filial na organização 2 por um motivo específico, e
  -- descobrir esse motivo foi o que o controle negativo desta conferência
  -- (rodá-la contra o schema PRÉ-MT3, para ver se ela realmente reprova)
  -- mostrou: sem um vínculo cruzado plantado, a checagem central passa até no
  -- banco antigo, porque sem linha em `user_branches` o `has_branch_access`
  -- de antes já devolvia false por outro motivo — provaria nada.
  --
  -- O ataque de verdade é em duas etapas: primeiro inserir a linha cruzada
  -- em `user_branches`, e só então `has_branch_access` passa a devolver true.
  -- Esta filial serve para simular a etapa 1 já consumada — o vínculo é
  -- plantado na seção 1.3 como `postgres`, que passa por cima da RLS,
  -- exatamente como ele chegaria por SQL direto ou por um caminho que
  -- ninguém previu. A checagem 2a então prova o que a seção 3 da migration
  -- afirma: mesmo com a linha existindo, o acesso é negado, porque a
  -- organização não bate. Defesa em profundidade medida, não deduzida.
  --
  -- A filial 2 (sem vínculo nenhum) continua existindo para a checagem 2b e
  -- para a 3, que precisa inserir o vínculo e falharia por chave duplicada
  -- se a linha já estivesse lá.
  insert into public.branches (id, code, name, organization_id)
  values (v_branch3, 'MT3ENVEN', 'MT3 VERIFICACAO — filial com vínculo cruzado', v_org2);

  -- 1.3 — os dois usuários temporários: o "atacante" na organização 1 e o
  --       alvo na organização 2
  --
  -- `profiles.id` referencia `auth.users(id)`, então não dá para criar perfil
  -- sem usuário de autenticação. Nenhum dos dois faz login: a senha é uma
  -- string fixa e inútil de propósito (não é hash válido de nada), então nem
  -- por acidente estas contas autenticam — a PARTE 2 as "encarna" forjando
  -- `request.jwt.claims`, que é o que a RLS lê.
  --
  -- O atacante é temporário, e não o administrador de verdade do banco, por
  -- uma razão concreta: o vínculo cruzado abaixo (`v_admin` → filial da
  -- organização 2) é uma linha envenenada de propósito. Plantá-la na conta de
  -- alguém que usa o sistema deixaria sujeira em dado de produção se a
  -- PARTE 3 não rodasse. Ele carrega o `role_id` do administrador real, então
  -- o poder testado continua sendo o poder real daquele papel.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'mt3-verificacao-admin@exemplo.invalido', 'SEM-LOGIN-MT3-VERIFICACAO',
     now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000000', v_user2, 'authenticated', 'authenticated',
     'mt3-verificacao@exemplo.invalido', 'SEM-LOGIN-MT3-VERIFICACAO',
     now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  insert into public.profiles (id, name, email, role_id, organization_id) values
    (v_admin, 'MT3 VERIFICACAO — admin temporário da organização 1',
     'mt3-verificacao-admin@exemplo.invalido', v_role, v_org1),
    (v_user2, 'MT3 VERIFICACAO — usuário temporário da organização 2',
     'mt3-verificacao@exemplo.invalido', null, v_org2);

  insert into public.user_branches (user_id, branch_id) values
    (v_admin, v_branch1),   -- vínculo legítimo, dentro da própria organização
    (v_admin, v_branch3),   -- vínculo CRUZADO, plantado (seção 1.2b)
    (v_user2, v_branch2);

  -- 1.4 — guarda os ids para a PARTE 2 (GUC de sessão: a única forma de
  -- passar valor entre statements soltos no SQL editor, que não tem `\set`)
  perform set_config('mt3.admin_id',   v_admin::text,   false);
  perform set_config('mt3.org1_id',    v_org1::text,    false);
  perform set_config('mt3.org2_id',    v_org2::text,    false);
  perform set_config('mt3.branch1_id', v_branch1::text, false);
  perform set_config('mt3.branch2_id', v_branch2::text, false);
  perform set_config('mt3.branch3_id', v_branch3::text, false);
  perform set_config('mt3.user2_id',   v_user2::text,   false);

  raise notice 'PREPARO OK — admin=% org1=% filial1=% | org2=% filial2=% filial3(envenenada)=% usuario2=%',
    v_admin, v_org1, v_branch1, v_org2, v_branch2, v_branch3, v_user2;
end
$$;


-- =====================================================================
-- PARTE 2 — as checagens (vira `authenticated`; a PARTE 3 desfaz)
-- =====================================================================
--
-- `set role authenticated` é o que liga a RLS: como dona das tabelas, a role
-- `postgres` passa por cima de toda policy, e um teste rodado por ela não
-- provaria nada. `request.jwt.claims` é de onde `auth.uid()` e `auth.role()`
-- leem — setá-lo é como o PostgREST entrega o JWT ao banco, então daqui para
-- baixo a sessão é, para todos os efeitos, o administrador da organização 1
-- chegando pela API.

set role authenticated;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('mt3.admin_id'), 'role', 'authenticated')::text,
  false
);

do $$
declare
  v_admin   uuid := current_setting('mt3.admin_id')::uuid;
  v_org2    uuid := current_setting('mt3.org2_id')::uuid;
  v_branch1 uuid := current_setting('mt3.branch1_id')::uuid;
  v_branch2 uuid := current_setting('mt3.branch2_id')::uuid;
  v_branch3 uuid := current_setting('mt3.branch3_id')::uuid;
  v_user2   uuid := current_setting('mt3.user2_id')::uuid;
  v_passou  boolean;
  v_linhas  int;
  v_erro    text;
begin
  -- 0 — a sessão é mesmo quem deveria ser?
  if (select auth.uid()) is distinct from v_admin then
    raise exception 'CHECAGEM 0 FALHOU: auth.uid() devolveu % mas a sessão deveria ser %. O set_config de request.jwt.claims não pegou — nada abaixo provaria coisa alguma.',
      (select auth.uid()), v_admin;
  end if;
  raise notice 'CHECAGEM 0 PASSOU — sessão autenticada como o administrador da organização 1.';

  -- 1 — has_branch_access DENTRO da própria organização continua true
  --     (esta vem antes da checagem 2 de propósito: uma função que devolve
  --     false para tudo passaria na 2 sem corrigir nada)
  if not coalesce(public.has_branch_access(v_branch1), false) then
    raise exception 'CHECAGEM 1 FALHOU: has_branch_access devolveu false para a filial % da PRÓPRIA organização do usuário. A migration quebrou o acesso legítimo.', v_branch1;
  end if;
  raise notice 'CHECAGEM 1 PASSOU — has_branch_access continua true dentro da própria organização.';

  -- 2a — a checagem central: has_branch_access é false contra a filial da
  --      organização 2 MESMO EXISTINDO a linha em user_branches
  --      (`v_branch3`, plantada na seção 1.2b). É esta que reprova o schema
  --      pré-MT3, e é a razão de a filial envenenada existir — ver lá.
  if coalesce(public.has_branch_access(v_branch3), false) then
    raise exception 'CHECAGEM 2a FALHOU: has_branch_access devolveu TRUE para a filial % da organização 2, com base numa linha de user_branches cruzando organização. É exatamente o vazamento central que MT3 existe para fechar: a função ainda confia na tabela de vínculo sem conferir organização.', v_branch3;
  end if;
  raise notice 'CHECAGEM 2a PASSOU — has_branch_access nega filial de outra organização MESMO com o vínculo existindo em user_branches (defesa em profundidade).';

  -- 2b — e também nega a filial da outra organização sem vínculo nenhum
  if coalesce(public.has_branch_access(v_branch2), false) then
    raise exception 'CHECAGEM 2b FALHOU: has_branch_access devolveu TRUE para a filial % da organização 2, sem nem existir vínculo.', v_branch2;
  end if;
  raise notice 'CHECAGEM 2b PASSOU — has_branch_access nega filial de outra organização sem vínculo.';

  -- 3 — vincular-se a uma filial de outra organização é recusado
  --     (o ataque concreto documentado no cabeçalho da migration: sem esta
  --     policy, a linha inserida aqui "provaria" o vínculo para
  --     has_branch_access)
  v_passou := false;
  begin
    insert into public.user_branches (user_id, branch_id) values (v_admin, v_branch2);
  exception when sqlstate '42501' then
    if sqlerrm not like 'new row violates row-level security policy%' then raise; end if;
    v_passou := true;
    v_erro := sqlstate || ' ' || sqlerrm;
  end;
  if not v_passou then
    raise exception 'CHECAGEM 3 FALHOU: o insert em user_branches ligando o administrador da organização 1 à filial % da organização 2 foi ACEITO. A policy "manage user_branches insert" não está conferindo organização.', v_branch2;
  end if;
  raise notice 'CHECAGEM 3 PASSOU — insert em user_branches cruzando organização recusado (%).', v_erro;

  -- 4 — o perfil da organização 2 é invisível, mesmo com can_manage_users
  select count(*) into v_linhas from public.profiles where id = v_user2;
  if v_linhas <> 0 then
    raise exception 'CHECAGEM 4 FALHOU: o administrador da organização 1 LEU % linha(s) do perfil % da organização 2. A policy "select profile" não está conferindo organização.', v_linhas, v_user2;
  end if;
  raise notice 'CHECAGEM 4 PASSOU — perfil de outra organização invisível para can_manage_users.';

  -- 5 — e também não é editável
  update public.profiles set name = 'MT3 INVASAO' where id = v_user2;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception 'CHECAGEM 5 FALHOU: o administrador da organização 1 EDITOU % linha(s) do perfil % da organização 2. A policy "update profile" não está conferindo organização.', v_linhas, v_user2;
  end if;
  raise notice 'CHECAGEM 5 PASSOU — perfil de outra organização não é editável por can_manage_users.';

  -- 6 — a filial da organização 2 é invisível, mesmo com can_manage_branches
  select count(*) into v_linhas from public.branches where id = v_branch2;
  if v_linhas <> 0 then
    raise exception 'CHECAGEM 6 FALHOU: o administrador da organização 1 LEU a filial % da organização 2. A metade can_manage_branches de "read accessible branches" não está conferindo organização.', v_branch2;
  end if;
  raise notice 'CHECAGEM 6 PASSOU — filial de outra organização invisível para can_manage_branches.';

  -- 7 — criar filial já nascendo na organização 2 é recusado
  v_passou := false;
  begin
    insert into public.branches (id, code, name, organization_id)
    values ('d3000000-0000-4000-8000-000000000006', 'MT3INVAS', 'MT3 INVASAO', v_org2);
  exception when sqlstate '42501' then
    if sqlerrm not like 'new row violates row-level security policy%' then raise; end if;
    v_passou := true;
    v_erro := sqlstate || ' ' || sqlerrm;
  end;
  if not v_passou then
    raise exception 'CHECAGEM 7 FALHOU: o administrador da organização 1 CRIOU uma filial dentro da organização 2. O WITH CHECK de "manage branches insert" não está conferindo organização.';
  end if;
  raise notice 'CHECAGEM 7 PASSOU — criar filial em outra organização recusado (%).', v_erro;

  -- 8 — o próprio usuário não consegue se mudar de organização
  --     (o buraco que a seção 8 da migration fecha no trigger
  --     prevent_role_escalation: a metade `id = auth.uid()` da policy
  --     "update profile" aprova a linha, e sem o trigger o atacante
  --     escolheria a organização contra a qual todo o resto é comparado)
  v_passou := false;
  begin
    update public.profiles set organization_id = v_org2 where id = v_admin;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Não autorizado a alterar a organização de um usuário.' then raise; end if;
    v_passou := true;
    v_erro := sqlstate || ' ' || sqlerrm;
  end;
  if not v_passou then
    raise exception 'CHECAGEM 8 FALHOU: o usuário conseguiu mudar a PRÓPRIA organization_id para %. O trigger profiles_prevent_role_escalation não está protegendo essa coluna — e com ela todo o resto da contenção cai junto.', v_org2;
  end if;
  raise notice 'CHECAGEM 8 PASSOU — usuário não muda a própria organização (%).', v_erro;

  -- 9 — o vínculo do usuário da organização 2 é invisível
  --     (metade can_manage_branches de "read own branch links")
  select count(*) into v_linhas
  from public.user_branches where user_id = v_user2;
  if v_linhas <> 0 then
    raise exception 'CHECAGEM 9 FALHOU: o administrador da organização 1 LEU % vínculo(s) de user_branches do usuário % da organização 2. A metade can_manage_branches de "read own branch links" não está conferindo organização.', v_linhas, v_user2;
  end if;
  raise notice 'CHECAGEM 9 PASSOU — vínculo de user_branches de outra organização invisível.';

  -- 10 — e também não é apagável ("manage user_branches delete")
  delete from public.user_branches where user_id = v_user2;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception 'CHECAGEM 10 FALHOU: o administrador da organização 1 APAGOU % vínculo(s) do usuário % da organização 2. A policy "manage user_branches delete" não está conferindo organização.', v_linhas, v_user2;
  end if;
  raise notice 'CHECAGEM 10 PASSOU — vínculo de user_branches de outra organização não é apagável.';

  -- 11 — o próprio usuário continua vendo seu vínculo cruzado.
  -- Isto não concede DELETE: só o administrador da organização da filial
  -- pode removê-lo. Esta checagem prova apenas a leitura do próprio vínculo.
  select count(*) into v_linhas
  from public.user_branches where user_id = v_admin and branch_id = v_branch3;
  if v_linhas <> 1 then
    raise exception 'CHECAGEM 11 FALHOU: o próprio usuário não enxerga o vínculo cruzado (%, %) que ele carrega — % linha(s). "read own branch links" ocultou o vínculo do próprio usuário.', v_admin, v_branch3, v_linhas;
  end if;
  raise notice 'CHECAGEM 11 PASSOU — vínculo cruzado preexistente continua visível para o próprio dono.';

  -- 12 — criar filial SEM mandar organization_id nasce na própria
  --      organização (o `default` da seção 4 da migration)
  --
  --      É o caminho que a tela de D1 usa: `createBranch` não manda
  --      `organization_id`. Sem o default, esta tarefa teria quebrado a
  --      criação de filial pelo produto; esta checagem é o que garante que
  --      não quebrou — e que a filial criada nasce na organização certa, e
  --      não em nenhuma outra.
  insert into public.branches (id, code, name) values ('d3000000-0000-4000-8000-000000000007', 'MT3PROPR', 'MT3 VERIFICACAO — filial própria');
  select count(*) into v_linhas
  from public.branches
  where id = 'd3000000-0000-4000-8000-000000000007' and organization_id = private.current_organization_id();
  if v_linhas <> 1 then
    raise exception 'CHECAGEM 12 FALHOU: filial criada sem organization_id explícito não nasceu na organização do criador (% linha[s] batendo). O default de branches.organization_id não está valendo, e a tela de filiais de D1 está quebrada.', v_linhas;
  end if;
  delete from public.branches where id = 'd3000000-0000-4000-8000-000000000007';
  raise notice 'CHECAGEM 12 PASSOU — filial criada sem organization_id nasce na organização de quem criou, e a tela de D1 continua funcionando.';

  raise notice '=== TODAS AS CHECAGENS (0 a 12) PASSARAM. Rode a PARTE 3 para limpar. ===';
end
$$;


-- =====================================================================
-- PARTE 3 — limpeza (rodar SEMPRE, inclusive se a PARTE 2 falhou)
-- =====================================================================
--
-- Idempotente e independente: apaga por id fixo, não depende de nenhum GUC
-- ter sobrevivido, e pode rodar quantas vezes for preciso. `reset role` vem
-- primeiro porque a PARTE 2 deixa a sessão como `authenticated` — inclusive
-- (e principalmente) quando morre no meio, e `authenticated` não apaga nada
-- do que a PARTE 1 criou.

reset role;
select set_config('request.jwt.claims', '', false);

do $$
declare
  v_org2    constant uuid := 'd3000000-0000-4000-8000-000000000001';
  v_branch2 constant uuid := 'd3000000-0000-4000-8000-000000000002';
  v_user2   constant uuid := 'd3000000-0000-4000-8000-000000000003';
  v_branch3 constant uuid := 'd3000000-0000-4000-8000-000000000004';
  v_admin   constant uuid := 'd3000000-0000-4000-8000-000000000005';
begin
  -- `auth.users` cascateia para `profiles`, e `branches` cascateia para
  -- `user_branches` — as linhas filhas somem junto, sem delete próprio.
  -- Isso inclui o vínculo legítimo do admin temporário com a filial REAL da
  -- organização 1 (`v_admin` → `v_branch1`), que não sai por cascata de
  -- filial nenhuma das temporárias: sai pela cascata de `auth.users`. É a
  -- única linha que este script escreve apontando para dado de produção, e
  -- é por isso que a exclusão do usuário vem primeiro.
  delete from auth.users where id in (v_user2, v_admin);

  -- A ordem daqui para baixo importa, e custou um erro real para descobrir:
  -- **toda** exclusão de filial precisa vir antes de qualquer exclusão de
  -- organização. `branches.organization_id` é uma FK sem cascata, então uma
  -- filial órfã apontando para a organização 2 faz o `delete` dela falhar por
  -- violação de chave estrangeira — e, se a rede de segurança abaixo
  -- estivesse depois, ela nunca rodaria para desfazer o nó. Isso não é
  -- hipotético: aconteceu rodando esta conferência contra o schema PRÉ-MT3,
  -- onde a checagem 7 (criar filial em outra organização) **é aceita**, e a
  -- filial 'MT3INVAS' resultante travou a limpeza inteira da vez seguinte.
  delete from public.branches where id in (v_branch2, v_branch3,
    'd3000000-0000-4000-8000-000000000006', 'd3000000-0000-4000-8000-000000000007');

  -- Limpeza somente pelos identificadores reservados acima, nunca por nome/código.
  delete from public.organizations where id = v_org2;

  raise notice 'LIMPEZA OK — organização, filial e usuário temporários de MT3 removidos. Sessão de volta como %.', current_user;
end
$$;
