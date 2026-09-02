-- B2 — ICMS-ST com MVA: a tabela `mva_rules` e o módulo que a cadastra (01/09/2026)
--
-- Segunda tarefa da Etapa 2 do "Mínimo pra vender", e continuação direta de B1.
-- B1 ensinou o motor a calcular o ICMS **próprio** por item (redução de base,
-- IPI, e os CST que não têm onde escrever valor). B2 acrescenta a camada de
-- cima: o ICMS **retido por substituição tributária**, que é o que os CST 10,
-- 30 e 70 (Regime Normal) e os CSOSN 201, 202 e 203 (Simples) declaram.
--
-- As nove colunas de ST e FCP de `fiscal_document_items` e as três de total de
-- `fiscal_documents` existem desde A3 e nunca foram escritas — `persist.ts`
-- gravava `total_icms_st_base`/`total_icms_st`/`total_fcp` como `null` fixo,
-- com o comentário "quem os preenche é o motor tributário da Etapa 2". É este.
-- **Nenhuma dessas colunas é criada aqui**; esta migration cria só o cadastro
-- que faltava para alimentá-las.
--
-- ## Por que uma tabela nova, e não mais colunas em `tax_groups`
--
-- Todas as alíquotas que B1 mexeu moram em `tax_groups` porque são do
-- **produto**: o mesmo item tributa igual, venda para onde vender. A MVA não.
-- Quem a publica é o estado **de destino**, por NCM, em protocolo ou convênio
-- ICMS-ST — o mesmo produto tem MVA diferente conforme o estado que recebe.
-- Pô-la em `tax_groups` obrigaria um grupo por combinação produto × UF, que é
-- o cadastro se multiplicando para representar uma dimensão que ele não tem.
--
-- A granularidade NCM × UF de destino é a mesma que os estados usam para
-- publicar as tabelas de ST, e o coringa `'*'` em `uf_destino` segue
-- exatamente o de `tax_rules` (`WILDCARD_UF_DESTINO`, em `taxRules.ts`): mais
-- específico vence, e uma linha coringa cobre "todo destino que não tiver
-- linha própria".
--
-- **`fcp_aliquota` mora aqui pelo mesmo motivo da MVA**: o Fundo de Combate à
-- Pobreza é percentual do estado de destino, cadastrado por NCM × UF junto com
-- a MVA nos mesmos protocolos. Em `tax_groups` ele seria uma alíquota só para
-- todos os destinos, que é justamente o que ele não é.
--
-- ## O que NÃO virou coluna, e por quê
--
--   - **`conteudo_importado`** (para a alíquota interestadual de 4% da
--     Resolução do Senado 13/2012) foi avaliado e **descartado**: o dado já
--     existe, em `products.origem_mercadoria`. Os códigos `1` e `2`
--     (importação integral), `3` (Conteúdo de Importação entre 40% e 70%) e `8`
--     (acima de 70%) são exatamente o universo dos 4%; `6` e `7` (estrangeira
--     **sem similar nacional**, lista CAMEX) e `4` (processo produtivo básico)
--     são exceções expressas da própria resolução e mantêm 7%/12%. Duplicar
--     isso numa coluna de `mva_rules` seria pior que redundante: importação é
--     atributo do **produto**, não do par NCM × UF, e as duas cópias
--     divergiriam no primeiro cadastro descuidado.
--   - **`reducao_base_st`** (`pRedBCST`) ficou de fora. A base do ST que B2
--     calcula parte da base do ICMS próprio, já com a redução do próprio
--     aplicada; uma segunda redução, só do ST, é outra dimensão de cadastro e
--     entraria compondo com a primeira de um jeito que precisa ser decidido, e
--     não adivinhado. `fiscal_document_items.icms_st_reducao_base` continua
--     nula, como está desde A3.
--
-- ## O que esta migration NÃO faz
--
--   - Não semeia nenhuma MVA. A tabela nasce vazia, e tabela vazia significa
--     "nenhuma mercadoria tem ST" — que é o comportamento de hoje. Nada muda de
--     valor em nenhuma nota até alguém cadastrar a primeira linha.
--   - Não mexe em `tax_rules`. O CFOP de venda com ST (5405/6404 e afins)
--     continua dependendo de o contador cadastrar uma `tax_rules` própria com
--     outra `natureza_operacao`; o sistema não a escolhe sozinho. É lacuna
--     conhecida e registrada no AGENTS.md — redesenhar as dimensões de
--     `resolveTaxRule` é tarefa maior e separada.

-- ---------------------------------------------------------------------
-- A tabela
-- ---------------------------------------------------------------------

create table if not exists public.mva_rules (
  id uuid primary key default gen_random_uuid(),
  ncm text not null,
  uf_destino text not null,
  mva_original numeric(7,4) not null,
  fcp_aliquota numeric(7,4),
  created_at timestamp with time zone not null default now()
);

comment on table public.mva_rules is
  'Margem de Valor Agregado do ICMS-ST por NCM x UF de destino (B2, 01/09/2026). Mesma granularidade com que os estados publicam os protocolos/convenios de ST. uf_destino aceita o coringa * (mesmo padrao de tax_rules.uf_destino): mais especifico vence. Tabela vazia significa que nenhuma mercadoria tem ST — nao ha valor padrao. resolveMvaRule() (supabase/functions/_shared/fiscal/mvaRules.ts) le esta tabela.';

comment on column public.mva_rules.ncm is
  'NCM de 8 digitos, sem pontuacao (mesmo formato de products.ncm e de ncm_codes.codigo). A comparacao no motor ignora pontuacao, entao 2202.10.00 e 22021000 casam — mas grave sem, para bater com o cadastro de Produtos.';
comment on column public.mva_rules.uf_destino is
  'Sigla da UF de destino, ou * para qualquer destino. Nao e campo de referencia a ufs justamente por causa do coringa (mesmo motivo ja registrado para tax_rules.uf_destino em 28/08/2026).';
comment on column public.mva_rules.mva_original is
  'MVA ST ORIGINAL do protocolo/convenio, em percentual (0 a 300). E a original, nao a ajustada: o ajuste para operacao interestadual e feito pelo motor, com a formula MVA ajustada = [(1 + MVA/100) x (1 - ALQ_inter/100) / (1 - ALQ_intra/100)] - 1. Cadastrar a ajustada aqui produziria ajuste em cima de ajuste.';
comment on column public.mva_rules.fcp_aliquota is
  'pFCPST — percentual do Fundo de Combate a Pobreza retido por ST no estado de destino, 0 a 100. Nula significa que este NCM/UF nao tem FCP — nao zero. Mora aqui, e nao em tax_groups, porque e percentual do destino: o mesmo produto tem FCP diferente conforme o estado que recebe.';

-- Uma MVA por NCM x UF (o coringa conta como uma UF): é a mesma garantia que
-- `tax_rules_dimensions_unique` dá lá, e é o que faz o desempate "mais
-- específico vence" ser determinístico — no máximo uma linha exata e uma
-- coringa por NCM, nunca duas do mesmo tipo brigando pelo mesmo lugar.
alter table public.mva_rules
  drop constraint if exists mva_rules_dimensions_unique;
alter table public.mva_rules
  add constraint mva_rules_dimensions_unique unique (ncm, uf_destino);

-- MVA acima de 300% existe (bebidas, cigarros e combustíveis passam de 100%),
-- então o teto é folgado de propósito — o que a constraint impede é sinal
-- trocado e dígito a mais, não margem alta. O FCP é 0–100 como as demais
-- alíquotas percentuais criadas em B1.
alter table public.mva_rules
  drop constraint if exists mva_rules_mva_original_check;
alter table public.mva_rules
  add constraint mva_rules_mva_original_check
  check (mva_original >= 0 and mva_original <= 300);

alter table public.mva_rules
  drop constraint if exists mva_rules_fcp_aliquota_check;
alter table public.mva_rules
  add constraint mva_rules_fcp_aliquota_check
  check (fcp_aliquota is null or (fcp_aliquota >= 0 and fcp_aliquota <= 100));

-- O motor lê a tabela inteira de uma vez (`readMvaRules`), como já faz com
-- `tax_rules`, então o índice não serve à emissão — serve à tela, que filtra
-- por NCM, e ao dia em que a tabela crescer o bastante para a leitura completa
-- deixar de valer.
create index if not exists mva_rules_lookup_idx on public.mva_rules using btree (ncm, uf_destino);

-- ---------------------------------------------------------------------
-- RLS — as quatro policies separadas, no padrão de tax_rules/tax_groups
-- ---------------------------------------------------------------------
--
-- Nunca `for all`: ela duplicaria a cobertura do `select` e dispararia
-- "multiple permissive policies" no advisor (convenção do README de
-- migrations). Sem `has_branch_access`: a tabela não tem `branch_id`, pelo
-- mesmo motivo de `tax_rules`/`tax_groups` — MVA é do estado de destino, não
-- da filial que vende.

alter table public.mva_rules enable row level security;

grant all on table public.mva_rules to anon;
grant all on table public.mva_rules to authenticated;
grant all on table public.mva_rules to service_role;

drop policy if exists "read mva_rules" on public.mva_rules;
create policy "read mva_rules" on public.mva_rules
  for select using (public.has_permission('mva-icms-st', 'view'));

drop policy if exists "insert mva_rules" on public.mva_rules;
create policy "insert mva_rules" on public.mva_rules
  for insert with check (public.has_permission('mva-icms-st', 'create'));

drop policy if exists "update mva_rules" on public.mva_rules;
create policy "update mva_rules" on public.mva_rules
  for update using (public.has_permission('mva-icms-st', 'edit'));

drop policy if exists "delete mva_rules" on public.mva_rules;
create policy "delete mva_rules" on public.mva_rules
  for delete using (public.has_permission('mva-icms-st', 'delete'));

-- ---------------------------------------------------------------------
-- O módulo `mva-icms-st`
-- ---------------------------------------------------------------------
--
-- Conferido antes de escrever: o módulo **não existia** em `modules` nem em
-- `module_fields`. Sem ele as policies acima recusariam tudo (`has_permission`
-- de um módulo inexistente é sempre falso) e ninguém teria como cadastrar uma
-- MVA pela aplicação — a tabela ficaria inalcançável dos dois lados.
--
-- `storage_kind = 'table'` com `data_table = 'mva_rules'`: roda na
-- `GenericModulePage`, sem componente próprio, exatamente como `tributacoes` e
-- `grupos-tributarios`. `is_locked = true` porque é módulo de sistema (o
-- `ModuleBuilderPage` não deve conseguir editá-lo), `branch_scoped = false`
-- porque a tabela não tem `branch_id`, e `sort_order = 92` fica na faixa dos
-- cadastros fiscais (tributacoes 80, grupos-tributarios 85, catálogos 86–89,
-- regimes-tributarios 91) sem renumerar nenhuma linha existente.

insert into public.modules
  (id, label, data_table, layout_variant, is_locked, path, icon_key,
   sort_order, show_on_home, access_gate, branch_scoped, storage_kind)
values
  ('mva-icms-st', 'MVA (ICMS-ST)', 'mva_rules', 'three', true, '/mva-icms-st', null,
   92, true, 'permission', false, 'table')
on conflict (id) do nothing;

-- Nenhum campo aponta `reference_module_id`, e isso é decisão, não omissão:
--   - `uf_destino` aceita o coringa `*`, e um campo de referência só oferece
--     siglas reais de `ufs` — virar referência apagaria o coringa em silêncio
--     na primeira edição pela tela. É a mesma decisão já tomada para
--     `tax_rules.uf_destino` em 28/08/2026, com o motivo registrado no
--     AGENTS.md daquele dia.
--   - `ncm` é texto livre porque `ncm_codes` (10.514 linhas) nunca virou
--     módulo — em Produtos o NCM é resolvido por `SearchCombobox` via
--     `search_ncm_codes`, mecanismo que a `GenericModulePage` não tem.
--     Consequência prática: aqui o NCM é digitado. Ligar a mesma busca a este
--     módulo é melhoria de tela, não de schema, e fica para quem for mexer na
--     `GenericModulePage`.
-- Como nenhuma linha tem `reference_module_id`, o trigger
-- `module_fields_guard_reference` não é acionado — não é preciso desligá-lo,
-- como a migration dos catálogos de 28/08/2026 precisou.

insert into public.module_fields
  (module_id, field_key, label, data_type, is_required, sort_order,
   show_in_table, table_width, table_align, show_in_details, show_in_form, hint)
values
  ('mva-icms-st', 'ncm', 'NCM', 'text', true, 10,
   true, '140px', 'center', true, true,
   'NCM de 8 dígitos, sem pontuação (o mesmo que está no cadastro do produto).'),
  ('mva-icms-st', 'uf_destino', 'UF de destino (ou * p/ qualquer)', 'text', true, 20,
   true, '160px', 'left', true, true,
   'Sigla do estado que recebe a mercadoria. Use * para valer em qualquer destino — uma linha com a UF exata vence a coringa.'),
  ('mva-icms-st', 'mva_original', 'MVA original (%)', 'text', true, 30,
   true, '140px', 'center', true, true,
   'A MVA ST ORIGINAL do protocolo/convênio, não a ajustada. Em operação interestadual o sistema calcula a ajustada sozinho.'),
  ('mva-icms-st', 'fcp_aliquota', 'Alíquota FCP (%)', 'text', false, 40,
   true, '140px', 'center', true, true,
   'Fundo de Combate à Pobreza retido por ST no estado de destino. Deixe vazio quando o estado não cobrar FCP.')
on conflict (module_id, field_key) do nothing;

-- Quem já podia cadastrar grupos tributários passa a poder cadastrar MVA: são o
-- mesmo trabalho (o cadastro fiscal que alimenta a emissão), feito pela mesma
-- pessoa. Copiar a permissão existente, em vez de fixar um papel pelo nome,
-- mantém a migration correta em qualquer ambiente — inclusive num banco
-- recriado do zero, onde os uuid dos papéis são outros.
insert into public.role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
select rp.role_id, 'mva-icms-st', rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
from public.role_permissions rp
where rp.module_id = 'grupos-tributarios'
on conflict (role_id, module_id) do nothing;
