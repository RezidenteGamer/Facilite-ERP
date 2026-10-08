-- MT3 — organização entra nas funções de autorização (11/09/2026)
--
-- **Esta migration NÃO foi aplicada no banco real; validada só em container.** A sessão que a escreveu
-- não tinha autorização para aplicar migration nem para fazer deploy, pela
-- mesma regra de D1, A11, D3, E4, MT1 e MT2.
--
-- Terceira e última tarefa da Etapa 1 de `facilite-multi-tenant-saas.md`.
-- MT1 (`...19`) criou `organizations` e `branches.organization_id`; MT2
-- (`...20`) criou `profiles.organization_id`. As duas anteriores eram
-- fundação de dado e não mudavam **nenhuma** regra de acesso — de propósito,
-- e registrado em ambas: "é MT3". Esta é a que cobra a promessa.
--
-- É a tarefa de maior alavancagem do plano inteiro e a mais sensível dele:
-- reescreve regras que já protegem dado em produção hoje. Um erro aqui é
-- silencioso até alguém explorar — o tipo de bug mais caro que existe num
-- SaaS (dado de um cliente pagante vazando para outro).
--
-- ## O achado que define o escopo: as duas correções precisam andar juntas
--
-- Pesquisa direta de cada `CREATE POLICY` de `baseline.sql` (grep completo,
-- não amostragem; conferido também que nenhuma das 7 funções de autorização
-- e nenhuma das 9 policies abaixo foi recriada em migration posterior —
-- todas continuam exatamente como o baseline as escreveu):
--
--   * `has_branch_access(p_branch_id)` hoje só confere se existe linha em
--     `user_branches`. Confia cegamente numa tabela que pode ter linha
--     cruzando organização.
--   * `manage user_branches insert` hoje é só `can_manage_branches()` — não
--     confere organização nenhuma. Um usuário com `can_manage_branches =
--     true` de **qualquer** organização pode inserir uma linha ligando a si
--     mesmo (ou a qualquer `user_id`) a uma filial de **outra** organização.
--     A partir daí, `has_branch_access` devolveria acesso a essa filial
--     estrangeira, porque a linha em `user_branches` "prova" o vínculo.
--
-- A função corrigida nega acesso mesmo com vínculo cruzado preexistente.
-- As policies também impedem criar novos vínculos cruzados. São proteções
-- complementares: contenção do acesso e integridade dos vínculos.
--
-- ## O que esta migration NÃO corrige, e por quê (limitação conhecida,
-- não esquecimento)
--
-- Três funções da mesma família **ficam como estão**, de propósito:
--
--   * `can_manage_permissions()` e `can_manage_modules()` — gateiam `roles`,
--     `role_permissions`, `modules`, `module_fields` e `module_tabs`.
--   * `has_permission(p_module_id, p_action)` — lê `role_permissions`/`roles`.
--
-- Nenhuma dessas cinco tabelas tem `organization_id` ainda: essa coluna só
-- nasce na Etapa 2 do plano (MT4 para `roles`/`role_permissions`, MT7 para
-- `modules` e família). Escrever aqui uma checagem contra uma coluna que
-- não existe não compilaria; escrever uma "equivalente" adivinhada (por
-- exemplo, derivar a organização do papel pelo perfil de quem o usa)
-- inventaria uma regra que nenhuma tarefa definiu e que MT4 teria de
-- desfazer. Consequência concreta enquanto a Etapa 2 não fechar: papéis,
-- permissões de papel e o catálogo de módulos continuam **globais** — um
-- usuário com `can_manage_permissions` de uma organização edita o papel que
-- outra organização também usa. Isso não é regressão desta migration (já é
-- assim hoje) e está registrado em MT1, MT2 e no plano; é o motivo pelo qual
-- a Etapa 1 sozinha **não** autoriza colocar uma segunda organização real
-- neste banco.
--
-- Pelo mesmo motivo, esta migration não toca `roles`, `contacts`,
-- `tax_groups`/`tax_rules` nem `modules` — Etapa 2, fora desta tarefa.
--
-- ## Forma escolhida para alterar policy existente: `drop` + `create`
--
-- `CREATE OR REPLACE POLICY` não existe no Postgres. As duas formas reais
-- são `ALTER POLICY ... USING (...) WITH CHECK (...)` e `drop policy if
-- exists` + `create policy`. Esta migration usa a segunda, que é o padrão já
-- praticado neste diretório (A1, `00000000000004`, usa `drop policy if
-- exists` sobre `fiscal_documents` e `sale_items`). DROP IF EXISTS + CREATE
-- também recria uma policy ausente; ALTER exige que ela exista, mas pode
-- ser reexecutado idempotentemente quando existe. Não existe
-- janela de tabela desprotegida entre o `drop` e o `create`: o runner da
-- Supabase aplica cada arquivo como uma transação só, e nenhuma outra sessão
-- enxerga o estado intermediário.

-- ---------------------------------------------------------------------
-- 1. `private.current_organization_id()` — a organização de quem está chamando
-- ---------------------------------------------------------------------
--
-- Toda checagem desta migration precisa responder "a qual organização
-- pertence o chamador?". Precisa ser função, e `security definer`, por dois
-- motivos, não um:
--
--   1. **Recursão.** Duas das policies reescritas aqui são sobre a própria
--      `profiles` (`select profile`, `update profile`). Um subselect
--      `select organization_id from profiles where id = auth.uid()` escrito
--      direto dentro delas dispararia a RLS de `profiles` de novo —
--      recursão infinita, erro em tempo de execução. Uma função
--      `security definer` pertencente a `postgres` (dona da tabela, e
--      `profiles` não usa `force row level security`) lê a linha sem passar
--      pela RLS. É exatamente o que `can_manage_users()` e as irmãs já
--      fazem hoje neste mesmo arquivo — não é padrão novo.
--   2. **Auditabilidade.** Uma policy que depende da RLS de outra tabela
--      muda de significado quando aquela outra policy muda. Encapsulando a
--      pergunta numa função `security definer`, cada policy abaixo diz uma
--      coisa só e continua dizendo a mesma coisa depois de MT4-MT7.
--
-- `(select auth.uid())` e não `auth.uid()` solto: é a forma que a Supabase
-- recomenda para expressão usada em RLS (o planner avalia uma vez por
-- consulta em vez de uma vez por linha). `has_branch_access` e as policies
-- de `profiles` já usavam essa forma no baseline; outras funções do arquivo
-- usam `auth.uid()` sem o `select`, de forma inconsistente. Tudo que esta
-- migration escreve usa a forma envolta — não regredir a otimização é parte
-- do escopo.
--
-- **Não confere `p.active`**, de propósito. `can_manage_branches()`,
-- `can_manage_users()` e `has_permission()` já exigem `active = true`, e
-- `has_branch_access` nunca exigiu. Somar a checagem de "ativo" aqui mudaria
-- **duas** coisas nesta migration (organização e situação do usuário) em vez
-- de uma, e apertaria silenciosamente um caminho que ninguém pediu
-- (`read accessible branches` pela metade `has_branch_access`, hoje aberta
-- para usuário inativo). Esta função responde só "de qual organização é este
-- usuário"; quem decide o que fazer com usuário inativo continua sendo quem
-- já decidia.
--
-- Devolve `NULL` quando não há sessão ou o perfil não existe. Toda
-- comparação abaixo é `coluna = (select private.current_organization_id())`, que com `NULL`
-- resulta `NULL` — e a RLS trata `NULL` como "não autorizado". Falha
-- fechada, que é o lado certo para errar.

-- Helpers internos: private não deve integrar os schemas expostos do Data API.
-- USAGE permite resolver as funções nas policies/default; não expõe RPCs.
-- Não concedemos CREATE nem permissões a anon. search_path vazio e todas as
-- relações/funções qualificadas evitam resolução de objetos de outro schema.
-- STABLE garante estabilidade no statement, não memoização. Nas policies,
-- subselects sem dependência da linha viram InitPlan. Helpers com argumento
-- da linha continuam correlacionados; seu plano interno pode rodar por chamada.
CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION "private"."current_organization_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select p.organization_id
  from public.profiles p
  where p.id = (select auth.uid());
$$;

ALTER FUNCTION "private"."current_organization_id"() OWNER TO "postgres";

COMMENT ON FUNCTION "private"."current_organization_id"() IS
  'Organização (organizations.id) do usuário autenticado, lida de profiles.organization_id. MT3, 11/09/2026, ver facilite-multi-tenant-saas.md. security definer de propósito: é chamada de dentro de policies sobre a própria profiles, e um subselect direto ali causaria recursão de RLS. Devolve NULL sem sessão ou sem perfil — toda comparação vira NULL e a RLS nega, falhando fechada. Não confere profiles.active: quem exige usuário ativo continua sendo can_manage_users/can_manage_branches/has_permission, como antes desta migration.';

REVOKE ALL ON FUNCTION "private"."current_organization_id"() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "private"."current_organization_id"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."current_organization_id"() TO "service_role";

-- ---------------------------------------------------------------------
-- 2. `private.branch_in_current_organization()` / `private.user_in_current_organization()`
-- ---------------------------------------------------------------------
--
-- Só as policies de `user_branches` precisam destas duas. `user_branches
-- (user_id, branch_id)` não tem `organization_id` própria — a organização de
-- uma linha dessa tabela só existe do outro lado de um join (com `branches`,
-- e com `profiles`).
--
-- Poderiam ser `exists (select 1 from public.branches ...)` escrito direto
-- na policy. Não são, pelo motivo (2) da seção 1, que aqui deixa de ser
-- estético e vira comportamento: um subselect sobre `branches` dentro de uma
-- policy de `user_branches` é avaliado **com a RLS de `branches` ligada**, e
-- um subselect sobre `profiles` idem. Consequência concreta se fossem
-- escritos assim: um usuário com `can_manage_branches` mas **sem**
-- `can_manage_users` não enxerga o perfil de mais ninguém (`select profile`),
-- então o `exists` sobre `profiles` daria falso e ele perderia a capacidade
-- de vincular outro usuário a uma filial — uma regressão de permissão que
-- esta tarefa não pediu e que não tem nada a ver com organização. Com
-- `security definer`, a pergunta é só sobre organização, como deve ser.

CREATE OR REPLACE FUNCTION "private"."branch_in_current_organization"("p_branch_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.branches b
    where b.id = p_branch_id
      and b.organization_id = (select private.current_organization_id())
  );
$$;

ALTER FUNCTION "private"."branch_in_current_organization"("p_branch_id" "uuid") OWNER TO "postgres";

COMMENT ON FUNCTION "private"."branch_in_current_organization"("p_branch_id" "uuid") IS
  'Esta filial pertence à organização do usuário autenticado? MT3, 11/09/2026. Existe para as policies de user_branches, que não têm organization_id na própria linha. security definer para não depender da RLS de branches (ver o comentário da seção 2 da migration 00000000000021).';

REVOKE ALL ON FUNCTION "private"."branch_in_current_organization"("p_branch_id" "uuid") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "private"."branch_in_current_organization"("p_branch_id" "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."branch_in_current_organization"("p_branch_id" "uuid") TO "service_role";

CREATE OR REPLACE FUNCTION "private"."user_in_current_organization"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.organization_id = (select private.current_organization_id())
  );
$$;

ALTER FUNCTION "private"."user_in_current_organization"("p_user_id" "uuid") OWNER TO "postgres";

COMMENT ON FUNCTION "private"."user_in_current_organization"("p_user_id" "uuid") IS
  'Este usuário pertence à organização do usuário autenticado? MT3, 11/09/2026. Usada só por "manage user_branches insert", para que nenhuma linha nova de vínculo nasça cruzando organização em nenhuma das duas pontas. security definer para não depender da RLS de profiles (ver o comentário da seção 2 da migration 00000000000021).';

REVOKE ALL ON FUNCTION "private"."user_in_current_organization"("p_user_id" "uuid") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "private"."user_in_current_organization"("p_user_id" "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."user_in_current_organization"("p_user_id" "uuid") TO "service_role";

-- ---------------------------------------------------------------------
-- 3. `has_branch_access` — a correção de maior alcance da migration
-- ---------------------------------------------------------------------
--
-- Esta função é chamada por dezenas de policies e RPCs (vendas, compras,
-- financeiro, caixa, notas fiscais, devoluções, condicionais,
-- `module_records`, a view `stock_movements_view`...). Corrigi-la aqui
-- propaga a contenção por organização para quase todo o sistema sem tocar em
-- mais nenhuma dessas policies — é literalmente por isso que MT3 é a tarefa
-- de maior alavancagem do plano.
--
-- O que muda: não basta mais existir a linha em `user_branches`; a filial
-- precisa pertencer à mesma organização do perfil do chamador. Defesa em
-- profundidade real, não redundância — mesmo que uma linha cruzando
-- organização já exista neste banco (ou seja inserida por um caminho que
-- ninguém previu), ela deixa de conceder acesso.
--
-- Mantido bit a bit: `STABLE SECURITY DEFINER`, `search_path`, e a forma
-- `(select auth.uid())`.
--
-- Plano de execução, medido com `explain` (não deduzido) num Postgres 15 com
-- 50 mil filiais, 20 mil perfis e 20 mil vínculos, rodando o corpo da função
-- sem RLS, que é como ele roda de verdade dentro de um `security definer`:
--
--     Index Only Scan using user_branches_pkey on user_branches ub
--       Index Cond: (user_id = $0) AND (branch_id = ...)
--     Index Scan using branches_pkey on branches b
--       Index Cond: (id = ...)   Filter: organization_id = (select private.current_organization_id())
--     -- e, dentro de private.current_organization_id():
--     Index Scan using profiles_pkey on profiles p   Index Cond: (id = $0)
--
-- Três buscas por índice único, nenhuma varredura sequencial; a busca em
-- `user_branches` é a mesma de hoje, pela mesma chave primária, com o mesmo
-- custo. STABLE não garante avaliação única. O subselect não correlacionado
-- produz um InitPlan, avaliado até uma vez por execução do plano que o contém.
-- Dentro de um helper chamado por linha, isso não significa um cache global.
-- Os índices que MT1 e MT2 criaram
-- (`branches_organization_id_idx`, `profiles_organization_id_idx`) não
-- aparecem **aqui**, e não deveriam: nesta função a organização é lida de uma
-- linha já localizada pela chave primária, não procurada por ela. Quem usa
-- `profiles_organization_id_idx` é `select profile` (seção 7).

CREATE OR REPLACE FUNCTION "public"."has_branch_access"("p_branch_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.user_branches ub
    join public.branches b on b.id = ub.branch_id
    where ub.user_id = (select auth.uid())
      and ub.branch_id = p_branch_id
      and b.organization_id = (select private.current_organization_id())
  );
$$;

COMMENT ON FUNCTION "public"."has_branch_access"("p_branch_id" "uuid") IS
  'O usuário autenticado tem acesso a esta filial? Desde MT3 (11/09/2026, ver facilite-multi-tenant-saas.md) exige duas coisas, não uma: existir o vínculo em user_branches E a filial pertencer à mesma organização do perfil do chamador. A segunda condição é defesa em profundidade sobre a primeira — uma linha de user_branches cruzando organização deixa de conceder acesso. Chamada por dezenas de policies e RPCs branch-scoped; é o ponto único por onde a contenção por organização chega a quase todo o sistema.';

-- ---------------------------------------------------------------------
-- 4. `branches.organization_id` ganha default — sem isto, a tela de D1 para
-- ---------------------------------------------------------------------
--
-- Achado desta tarefa, não previsto no plano, e a razão de esta seção
-- existir: `createBranch` (`src/lib/repositories/branchesRepository.ts`), o
-- único caminho de criação de filial do produto, **não manda
-- `organization_id`** — nenhuma ocorrência de `organization_id` em `src/`,
-- conferido. Desde que MT1 tornou a coluna `not null`, aquele `insert` já
-- falha por violação de `not null` (consequência de MT1, não desta
-- migration). A policy `manage branches insert` que a seção 5 escreve
-- tornaria o problema pior de outro jeito: passaria a exigir
-- `organization_id = (select private.current_organization_id())` num `insert` que não manda a
-- coluna de jeito nenhum.
--
-- A correção **não** é ensinar o front-end a mandar `organization_id`: um
-- valor de organização vindo do cliente é exatamente a superfície de ataque
-- que esta migration inteira existe para fechar (é o mesmo raciocínio que
-- MT2 aplicou em `admin-users` — "a resolução do valor é inteiramente do
-- servidor"). O `default` resolve no servidor, sem tela nova e sem mudar
-- nenhuma linha de `src/`: filial criada por usuário autenticado nasce na
-- organização dele, e a `WITH CHECK` da seção 5 vira defesa em profundidade
-- sobre um cliente que tente mandar outra organização explicitamente.
--
-- Escrita direta por SQL/`service_role` (provisionamento de MT9, o script de
-- verificação desta tarefa) não tem `auth.uid()`: o default resolve `NULL` e
-- o `not null` recusa. Correto — provisionamento tem de dizer explicitamente
-- em qual organização está criando, nunca herdar por acidente.

ALTER TABLE "public"."branches"
  ALTER COLUMN "organization_id" SET DEFAULT "private"."current_organization_id"();

-- ---------------------------------------------------------------------
-- 5. Policies de `branches` — comparação direta de coluna
-- ---------------------------------------------------------------------
--
-- `can_manage_branches()` é zero-argumento: não recebe a linha, então não há
-- como corrigi-la "por dentro". Quem ganha a checagem são as policies que a
-- usam como bypass geral.
--
-- Forma escolhida: **comparação direta de coluna**
-- (`organization_id = (select private.current_organization_id())`), e não `EXISTS` com join.
-- A linha avaliada **é** a filial, e `branches.organization_id` está ali na
-- própria linha — um `EXISTS` re-buscaria por PK a mesma linha que o executor
-- já tem em mãos, sem ganhar nada, e viraria subplano correlacionado por
-- linha. `user_branches` (seção 6) é o caso oposto, e usa a outra forma, pelo
-- motivo oposto.
--
-- Plano: o OR com public.has_branch_access(id) pode exigir Seq Scan.
-- As funções sem argumentos ficam em InitPlan; STABLE isoladamente não
-- garante isso. A escolha de índice depende das estatísticas e seletividade.
-- As quatro policies abaixo são as mesmas quatro de antes, com a mesma
-- cláusula somada — nenhuma regra de permissão foi afrouxada, nenhuma
-- condição existente foi removida.

DROP POLICY IF EXISTS "read accessible branches" ON "public"."branches";
CREATE POLICY "read accessible branches" ON "public"."branches"
  FOR SELECT TO "authenticated"
  USING (
    "public"."has_branch_access"("id")
    OR ((select "public"."can_manage_branches"()) AND "organization_id" = (select "private"."current_organization_id"()))
  );

DROP POLICY IF EXISTS "manage branches insert" ON "public"."branches";
CREATE POLICY "manage branches insert" ON "public"."branches"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    (select "public"."can_manage_branches"()) AND "organization_id" = (select "private"."current_organization_id"())
  );

-- `USING` e `WITH CHECK` com a mesma condição, como no baseline. O `WITH
-- CHECK` aqui não é repetição: sem ele, quem gerencia filiais poderia
-- **mover** a própria filial para outra organização com um `update`, que é o
-- mesmo vazamento por outro verbo.
DROP POLICY IF EXISTS "manage branches update" ON "public"."branches";
CREATE POLICY "manage branches update" ON "public"."branches"
  FOR UPDATE TO "authenticated"
  USING (
    (select "public"."can_manage_branches"()) AND "organization_id" = (select "private"."current_organization_id"())
  )
  WITH CHECK (
    (select "public"."can_manage_branches"()) AND "organization_id" = (select "private"."current_organization_id"())
  );

DROP POLICY IF EXISTS "manage branches delete" ON "public"."branches";
CREATE POLICY "manage branches delete" ON "public"."branches"
  FOR DELETE TO "authenticated"
  USING (
    (select "public"."can_manage_branches"()) AND "organization_id" = (select "private"."current_organization_id"())
  );

-- ---------------------------------------------------------------------
-- 6. Policies de `user_branches` — `EXISTS` encapsulado em função
-- ---------------------------------------------------------------------
--
-- Aqui a forma é a outra, pelo motivo oposto ao da seção 5: a linha
-- (`user_id`, `branch_id`) não carrega organização nenhuma, então a checagem
-- **precisa** de join. Encapsulado nas funções da seção 2 para não depender
-- da RLS de `branches`/`profiles` (ver lá o porquê, que é comportamental e
-- não estético).
--
-- **`insert` confere as duas pontas**: a filial e o usuário. A filial fecha
-- o ataque documentado no cabeçalho (ligar-se a uma filial estrangeira). A
-- ponta do usuário é defesa em profundidade: ligar um usuário estrangeiro a
-- uma filial *daqui* já seria inerte depois da seção 3 (`has_branch_access`
-- compara a organização da filial com a do perfil **daquele** usuário, que
-- não bate), mas a linha ficaria lá, e uma tarefa futura da Etapa 2 poderia
-- acabar confiando nela. Nenhuma linha nova de vínculo nasce cruzando
-- organização, em nenhuma das duas pontas.
--
-- **`select` e `delete` conferem só a ponta da filial**, e isso é decisão,
-- não descuido. Uma linha cruzada que já exista neste banco (inserida antes
-- desta migration, por SQL direto) precisa continuar **visível e apagável**
-- por quem administra a filial envolvida — que é quem tem legitimidade sobre
-- aquele vínculo e quem vai querer limpá-lo. Exigir as duas pontas no
-- `delete` transformaria toda linha cruzada preexistente em lixo que só
-- `service_role` conseguiria remover. `select` e `delete` com a mesma
-- condição também mantêm a propriedade óbvia de "o que você enxerga, você
-- consegue apagar".
--
-- `user_branches` não tem policy de `update` (não tinha antes, não ganha
-- agora): a tabela é só `(user_id, branch_id)`, um `update` seria
-- indistinguível de `delete` + `insert`, e ambos já estão cobertos.

DROP POLICY IF EXISTS "read own branch links" ON "public"."user_branches";
CREATE POLICY "read own branch links" ON "public"."user_branches"
  FOR SELECT TO "authenticated"
  USING (
    ("user_id" = ( SELECT "auth"."uid"() AS "uid"))
    OR ((select "public"."can_manage_branches"()) AND "private"."branch_in_current_organization"("branch_id"))
  );

DROP POLICY IF EXISTS "manage user_branches insert" ON "public"."user_branches";
CREATE POLICY "manage user_branches insert" ON "public"."user_branches"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    (select "public"."can_manage_branches"())
    AND "private"."branch_in_current_organization"("branch_id")
    AND "private"."user_in_current_organization"("user_id")
  );

DROP POLICY IF EXISTS "manage user_branches delete" ON "public"."user_branches";
CREATE POLICY "manage user_branches delete" ON "public"."user_branches"
  FOR DELETE TO "authenticated"
  USING (
    (select "public"."can_manage_branches"()) AND "private"."branch_in_current_organization"("branch_id")
  );

-- ---------------------------------------------------------------------
-- 7. Policies de `profiles` — mesmo tratamento, via `can_manage_users()`
-- ---------------------------------------------------------------------
--
-- `profiles.organization_id` existe desde MT2 e está na própria linha
-- avaliada: comparação direta de coluna, mesma forma e mesmo motivo da
-- seção 5. O índice profiles_organization_id_idx continua disponível para
-- a igualdade com o parâmetro do InitPlan. EXPLAIN deve ser medido como
-- authenticated: o plano de postgres não exercita as policies.
--
-- A metade `id = auth.uid()` continua intocada — todo usuário lê e edita o
-- próprio perfil, independente de qualquer coisa. Quem ganha a checagem de
-- organização é só a metade de bypass administrativo.
--
-- Nenhuma policy de `insert` ou `delete` sobre `profiles` existe (conferido:
-- só estas duas no banco inteiro), então não há outra porta aqui — perfil
-- nasce só por `service_role`, na Edge Function `admin-users`, que MT2 já
-- ensinou a preencher `organization_id` a partir de quem está criando.
--
-- Sobre o trigger `profiles_prevent_role_escalation`: ele **não** precisava
-- de mudança por causa das policies acima (raciocínio conferido, não
-- presumido) — é `BEFORE UPDATE ... FOR EACH ROW`, e a RLS de
-- `update profile` decide antes dele quais linhas o `update` alcança, então
-- ele nunca chega a ver uma linha de organização estrangeira. Mas ele
-- precisava de mudança por **outro** motivo, que é a seção 8.

DROP POLICY IF EXISTS "select profile" ON "public"."profiles";
CREATE POLICY "select profile" ON "public"."profiles"
  FOR SELECT TO "authenticated"
  USING (
    ("id" = ( SELECT "auth"."uid"() AS "uid"))
    OR ((select "public"."can_manage_users"()) AND "organization_id" = (select "private"."current_organization_id"()))
  );

DROP POLICY IF EXISTS "update profile" ON "public"."profiles";
CREATE POLICY "update profile" ON "public"."profiles"
  FOR UPDATE TO "authenticated"
  USING (
    ("id" = ( SELECT "auth"."uid"() AS "uid"))
    OR ((select "public"."can_manage_users"()) AND "organization_id" = (select "private"."current_organization_id"()))
  )
  WITH CHECK (
    ("id" = ( SELECT "auth"."uid"() AS "uid"))
    OR ((select "public"."can_manage_users"()) AND "organization_id" = (select "private"."current_organization_id"()))
  );

-- ---------------------------------------------------------------------
-- 8. `prevent_role_escalation` passa a proteger `organization_id`
-- ---------------------------------------------------------------------
--
-- Segundo achado desta tarefa, e o mais sério dos dois de dentro do banco.
-- Sem esta seção, as policies da seção 7 teriam um buraco por baixo:
-- `update profile` autoriza a metade `id = auth.uid()` **sem olhar
-- organização** (e tem de ser assim — é a linha do próprio usuário). Então
-- qualquer usuário autenticado poderia rodar
-- `update profiles set organization_id = <outra organização> where id = me`,
-- e a policy aprovaria, porque `id = auth.uid()` sozinho satisfaz `USING` e
-- `WITH CHECK`. A partir daí, todas as checagens que esta migration acabou
-- de escrever passariam a comparar contra a organização **escolhida pelo
-- atacante** — um usuário com `can_manage_users` leria os perfis da outra
-- organização, um com `can_manage_branches` enxergaria as filiais dela.
-- Seria uma escalação criada por MT2 (que trouxe a coluna) e ativada por
-- esta própria migration (que passou a confiar nela).
--
-- A porta certa é a que este banco já usa para "coluna que o dono da linha
-- não pode mudar sobre si mesmo": o trigger `prevent_role_escalation`, que
-- já guarda `role_id` e `is_facilite_developer` exatamente assim. Somar
-- `organization_id` ali cobre **todo** caminho de escrita (inclusive um que
-- alguma policy futura abra por engano), e não depende de sutileza de
-- snapshot de `WITH CHECK`.
--
-- `auth.role() <> 'service_role'`: mesma exceção, com a mesma forma, que a
-- regra de `role_id` logo acima já usa. `service_role` continua podendo
-- mover um usuário de organização (é o que MT9 e o suporte vão precisar), e
-- SQL direto no banco também — fora de uma requisição PostgREST `auth.role()`
-- é `NULL`, o `and` resulta `NULL`, e o `if` não dispara. Escolhi
-- deliberadamente a forma de `role_id` e não a de `is_facilite_developer`
-- (`auth.role() is not null`, que bloqueia até `service_role`): trocar a
-- organização de um usuário é operação legítima de administração de
-- plataforma, diferente de marcar alguém como desenvolvedor do Facilite.
--
-- O resto da função fica bit a bit como estava.

CREATE OR REPLACE FUNCTION "public"."prevent_role_escalation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.role_id is distinct from old.role_id
     and auth.role() <> 'service_role'
     and not public.can_manage_users() then
    raise exception 'Não autorizado a alterar o papel de acesso.';
  end if;

  -- MT3 (11/09/2026): sem isto, qualquer usuário se mudaria de organização
  -- pela metade `id = auth.uid()` da policy `update profile`, e passaria a
  -- ser tratado como membro da organização que escolhesse.
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

COMMENT ON COLUMN "public"."profiles"."organization_id" IS
  'Organização (empresa cliente do Facilite) à qual este usuário pertence — MT2, 11/09/2026, ver facilite-multi-tenant-saas.md. NOT NULL desde a criação: todo usuário pertence a exatamente uma organização, sem estado transitório "sem organização". Preenchida por supabase/functions/admin-users/index.ts na criação (herdada do organization_id do perfil de quem cria, ou da organização única no caminho de bootstrap). Desde MT3 esta coluna é a origem de toda checagem de organização do sistema (private.current_organization_id()), e o trigger profiles_prevent_role_escalation recusa alterá-la por qualquer caminho que não seja service_role ou SQL direto.';

-- ---------------------------------------------------------------------
-- O que esta migration deliberadamente NÃO faz
-- ---------------------------------------------------------------------
--
--   * **Não muda `can_manage_permissions()`, `can_manage_modules()` nem
--     `has_permission()`.** Nem as policies que dependem delas (`roles`,
--     `role_permissions`, `modules`, `module_fields`, `module_tabs`,
--     `module_situations`, `module_transitions`). Motivo completo no
--     cabeçalho: nenhuma dessas tabelas tem `organization_id` ainda — é
--     MT4 e MT7, Etapa 2 do plano. Enquanto isso, papéis, permissões de
--     papel e catálogo de módulos continuam globais entre organizações.
--   * **Não muda `can_manage_users_for(p_user_id)`.** Ela não gateia policy
--     nenhuma (conferido: única chamadora é a Edge Function `admin-users`) e
--     responde uma pergunta que continua correta — "este usuário tem o flag
--     de gerenciar usuários?". O buraco que existia era no **uso** dela, em
--     `admin-users`, ação `reset-password`, e foi corrigido lá, em
--     `supabase/functions/admin-users/index.ts`, não aqui.
--   * **Não muda `has_facilite_developer_access()`.** Acesso de
--     desenvolvedor do Facilite é transversal a organizações de propósito
--     (é a fundação da Etapa 6, MT12-MT14).
--   * **Não mexe em `roles`, `contacts`, `tax_groups`/`tax_rules` nem
--     `modules`.** Etapa 2 (MT4-MT7).
--   * **Não abre nenhuma tela nova** nem muda nenhuma tela existente. O
--     `default` da seção 4 existe justamente para que nenhuma linha de
--     `src/` precise mudar.
--   * **Não prova isolamento entre organizações.** Isso é MT8 (Etapa 3), que
--     constrói a bateria automatizada. Esta tarefa entrega um script de
--     conferência manual (`supabase/verificacao/mt3_isolamento_organizacao.sql`)
--     para a sessão que aplicar a migration rodar na mão — atalho de
--     verificação, não substituto de MT8.
