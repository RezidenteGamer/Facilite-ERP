-- B1 — resolução tributária por item: IPI e redução de base no grupo (01/09/2026)
--
-- Etapa 2 do "Mínimo pra vender", primeira tarefa. A3 criou as colunas por
-- imposto de `fiscal_document_items` e disse, no `comment on table`, que elas
-- nascem nulas porque "quem as preenche é o motor tributário da Etapa 2, que
-- ainda não existe". Esta migration é o cadastro de onde esse motor tira duas
-- das coisas que faltavam: **a alíquota e o CST de IPI**, e **o percentual de
-- redução da base de cálculo do ICMS**.
--
-- O que o mapeamento fazia até aqui, e por que não bastava:
--
--   - ICMS/PIS/COFINS eram `base × alíquota / 100`, sem redução de base
--     nenhuma. Um grupo com redução (o caso mais comum da tributação estadual
--     brasileira — cesta básica, alguns regimes especiais) não tinha onde
--     declará-la, e a nota saía com ICMS a maior.
--   - IPI não era calculado. `NfePayloadItem` já tinha `ipi_base_calculo`,
--     `ipi_aliquota` e `ipi_valor`, e `fiscal_document_items` já tinha
--     `ipi_base`/`ipi_aliquota`/`ipi_valor` — os seis campos existiam desde
--     A3/A1 e nunca eram preenchidos, porque `tax_groups` não tinha alíquota
--     de IPI.
--
-- ## Decisão 1: o CST de IPI muda de `products` para `tax_groups`
--
-- A correção de 19/08/2026 tirou os seis CSTs de `products` e os moveu para o
-- grupo tributário, deixando **`products.cst_ipi` para trás de propósito** —
-- e registrando o motivo no AGENTS.md: "`tax_groups` não tem campo de IPI,
-- então `cst_ipi` não era redundante (…) Se IPI virar assunto de verdade, o
-- lugar dele é no grupo, junto do resto." IPI virou assunto de verdade aqui.
--
-- O que decide é a alíquota: ela vai para o grupo (é lá que moram todas as
-- outras), e CST e alíquota são as duas metades do **mesmo grupo XML**
-- (`IPITrib`, com `CST` + `vBC` + `pIPI` + `vIPI`). Guardar as duas metades em
-- tabelas diferentes é convidar o cadastro a se contradizer: produto com CST 52
-- (isenta) e grupo com alíquota 5% descreveriam duas notas diferentes.
--
-- **`products.cst_ipi` NÃO é removida aqui**, e isso também é decisão. Não há
-- como migrar o dado: N produtos apontam para o mesmo grupo e podem ter CSTs
-- de IPI diferentes entre si, então não existe `update tax_groups set cst_ipi
-- = ...` correto. A coluna vira **fallback de leitura** — o mapeamento usa
-- `coalesce(grupo, produto)`, o grupo sempre vence —, ganha um
-- `comment on column` dizendo isso, e o `drop` fica para a tarefa que migrar o
-- cadastro. É o mesmo padrão que A3 usou com as colunas `cancel_*` (marcadas
-- obsoletas, removidas por A1 depois que ninguém mais escrevia nelas).
--
-- ## Decisão 2: redução de base só para ICMS
--
-- `reducao_base_icms` é a única coluna de redução criada aqui, e o motivo já
-- está escrito em A3, no `comment on column
-- fiscal_document_items.icms_reducao_base`: **`pRedBC` só existe, no leiaute
-- 4.00 da NF-e, para o ICMS próprio e para o ICMS-ST (`pRedBCST`)**. PIS,
-- COFINS e IPI não têm campo de percentual de redução no XML — quando a
-- legislação reduz a base deles, o que se declara é a base menor, sem dizer o
-- percentual. Criar `reducao_base_pis`/`_cofins`/`_ipi` produziria três colunas
-- que o motor leria e não teria onde escrever.
--
-- `reducao_base_icms_st` (o `pRedBCST`) **não entra aqui**: ICMS-ST inteiro,
-- com MVA e a tabela `mva_rules`, é a tarefa B2. A coluna correspondente em
-- `fiscal_document_items` (`icms_st_reducao_base`) já existe desde A3 e
-- continua nula até lá.
--
-- ## O que esta migration NÃO faz
--
--   - Não mexe em RLS. `tax_groups` já tem as quatro policies separadas de
--     `grupos-tributarios` (`select`/`insert`/`update`/`delete`, criadas em
--     19/08/2026) e elas são por linha, não por coluna: coluna nova numa tabela
--     que já tem RLS é coberta pela policy que já existe. Os `grant` de tabela
--     (`anon`/`authenticated`/`service_role`) também são por tabela.
--   - Não semeia nenhum valor. Todas as três colunas nascem nulas em todos os
--     grupos, e nulo continua significando "não calculado": até alguém
--     cadastrar alíquota de IPI, nenhuma nota muda de valor.

alter table public.tax_groups
  add column if not exists reducao_base_icms numeric(7,4),
  add column if not exists cst_ipi text,
  add column if not exists aliquota_ipi numeric(7,4);

-- As colunas de alíquota que já existiam (`aliquota_icms`, `aliquota_pis`,
-- `aliquota_cofins`) nasceram sem check constraint, em 19/08/2026. As novas
-- nascem com — percentual fora de 0–100 não é "cadastro incomum", é dado que
-- produz base negativa no cálculo. As antigas ficam como estão: pôr constraint
-- retroativa numa coluna com dado em produção é mudança de outra natureza, e
-- não é o assunto desta tarefa.
alter table public.tax_groups
  drop constraint if exists tax_groups_reducao_base_icms_check;
alter table public.tax_groups
  add constraint tax_groups_reducao_base_icms_check
  check (reducao_base_icms is null or (reducao_base_icms >= 0 and reducao_base_icms <= 100));

alter table public.tax_groups
  drop constraint if exists tax_groups_aliquota_ipi_check;
alter table public.tax_groups
  add constraint tax_groups_aliquota_ipi_check
  check (aliquota_ipi is null or (aliquota_ipi >= 0 and aliquota_ipi <= 100));

comment on column public.tax_groups.reducao_base_icms is
  'pRedBC, em percentual (0 a 100). A base do item vira valor x (1 - reducao/100) antes da aliquota. So ICMS tem esta coluna: pRedBC (e pRedBCST, que e da tarefa B2) e o unico percentual de reducao de base que existe no leiaute 4.00 da NF-e — PIS/COFINS/IPI nao tem campo equivalente no XML.';
comment on column public.tax_groups.cst_ipi is
  'CST de IPI. Fonte canonica desde B1 (01/09/2026); products.cst_ipi continua sendo lido como fallback para os produtos cadastrados antes disso, com o grupo sempre vencendo. Mora aqui, e nao no produto, porque a aliquota de IPI mora aqui e as duas sao metades do mesmo grupo XML (IPITrib).';
comment on column public.tax_groups.aliquota_ipi is
  'pIPI, em percentual (0 a 100). Nula significa que o grupo nao tributa IPI — nao zero. Cadastrar aliquota sem cst_ipi recusa a emissao com mensagem propria.';

comment on column public.products.cst_ipi is
  'OBSOLETA desde B1 (01/09/2026): o lugar canonico do CST de IPI passou a ser tax_groups.cst_ipi, junto da aliquota. Continua sendo lida como fallback pelos produtos cadastrados antes de B1 (o grupo vence quando os dois existem). O drop fica para a tarefa que migrar o cadastro produto a produto — nao ha update automatico possivel, porque N produtos com CSTs de IPI diferentes podem apontar para o mesmo grupo.';

comment on table public.tax_groups is
  'Grupo tributario: perfil nomeado e reutilizavel de CST/CSOSN, aliquotas e reducao de base, atrelado ao produto (products.tax_group_id). Correcao da etapa 7: CFOP e da operacao (tax_rules), CST/aliquota sao do produto. IPI (CST + aliquota) entrou em B1, 01/09/2026. Nao isolada por filial.';

-- ---------------------------------------------------------------------
-- Os tres campos na tela de Grupos tributarios
-- ---------------------------------------------------------------------
--
-- `grupos-tributarios` roda na GenericModulePage (storage_kind = 'table', sem
-- componente proprio), entao coluna nova so aparece no formulario e na ficha
-- se existir a linha correspondente em `module_fields` — sem isto as colunas
-- existem no banco e ninguem consegue preenche-las pela aplicacao, o que
-- deixaria B1 sem meio de uso. Mesmo padrao da migration
-- `add_module_fields_fiscal_produtos_contacts` (14/08/2026).
--
-- `data_type: 'text'` acompanha `aliquota_icms`/`aliquota_pis`/`aliquota_cofins`,
-- que sao text no motor generico desde 19/08/2026 (o achado sobre campo
-- numerico no motor esta registrado no AGENTS.md daquele dia).
--
-- Os `sort_order` sao intermediarios de proposito — 55 entre a aliquota de ICMS
-- (50) e o CST de PIS (60), 95/96 entre a aliquota de COFINS (90) e o CST de
-- IBS/CBS (100) —, para nenhuma linha existente precisar ser renumerada.
-- Nenhum dos tres vai para a lista (`show_in_table = false`), igual aos campos
-- de PIS/COFINS: a tabela ja mostra cinco colunas.

insert into public.module_fields
  (module_id, field_key, label, data_type, is_required, sort_order, show_in_table, show_in_details, show_in_form, hint)
values
  ('grupos-tributarios', 'reducao_base_icms', 'Redução de base ICMS (%)', 'text', false, 55, false, true, true,
   'Percentual de redução da base de cálculo do ICMS (pRedBC), de 0 a 100. Deixe vazio quando não houver redução.'),
  ('grupos-tributarios', 'cst_ipi', 'CST IPI', 'text', false, 95, false, true, true,
   'Tributam IPI: 00 e 49 (entrada), 50 e 99 (saída). Os demais (01–05, 51–55) são alíquota zero, isenção, imunidade, não tributação ou suspensão, e saem sem valor.'),
  ('grupos-tributarios', 'aliquota_ipi', 'Alíquota IPI (%)', 'text', false, 96, false, true, true,
   'Preencha junto com o CST IPI. Vazio significa que o grupo não tributa IPI.')
on conflict (module_id, field_key) do nothing;
