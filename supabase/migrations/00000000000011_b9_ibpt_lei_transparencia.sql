-- B9 — Lei da Transparência Fiscal: a tabela `ibpt_rates`, o módulo que a
-- cadastra e as duas colunas de `vTotTrib` (05/09/2026)
--
-- Sexta tarefa da Etapa 2 do "Mínimo pra vender". As anteriores (B1, B2, B5,
-- B8, B4) ensinaram o motor a **calcular imposto**. Esta não calcula imposto
-- nenhum: acrescenta a única informação do documento fiscal que existe para o
-- **consumidor** ler, e não para o fisco cobrar.
--
--   > Emitidos por ocasião da venda ao consumidor de mercadorias e serviços,
--   > em todo território nacional, deverá constar, dos documentos fiscais ou
--   > equivalentes, a informação do valor aproximado correspondente à
--   > totalidade dos tributos federais, estaduais e municipais, cuja incidência
--   > influi na formação dos respectivos preços de venda.
--   >
--   > — Lei 12.741/2012, art. 1º, caput (regulamentada pelo Decreto 8.264/2014)
--
-- No leiaute 4.00 isso é o campo `vTotTrib`, que aparece em **dois** lugares:
-- `det/imposto/vTotTrib` (id M02) por item e `total/ICMSTot/vTotTrib` (id W16a)
-- no cabeçalho. Os dois são opcionais — e a igualdade entre o total e a soma
-- dos itens é exigida sem tolerância (rejeição 685).
--
-- ## Cadastro manual, e NÃO importação em massa da tabela do IBPT
--
-- Esta é a decisão de desenho da tarefa, e ela foi pesquisada antes de
-- qualquer linha de código. A fonte de mercado dos percentuais é a tabela
-- "De Olho no Imposto", do IBPT, que o próprio Decreto 8.264/2014 (art. 5º)
-- autoriza: os valores "poderão ser calculados e fornecidos, semestralmente,
-- por instituição de âmbito nacional reconhecidamente idônea".
--
-- Ela **não** é semeada aqui, e o motivo não é técnico:
--
--   - O termo de uso do IBPT (deolhonoimposto.ibpt.org.br/Site/termodeuso)
--     libera o download **mediante cadastro** da pessoa física ou jurídica
--     usuária "em cumprimento à Lei 12.741/2012", e é expresso ao vedar a
--     comercialização pelo usuário. É licença de uso a quem se cadastra — não
--     dado público de uso livre. O download é gratuito, o que **não** é o mesmo
--     que livre para redistribuir dentro de um produto.
--   - Isso é o oposto de CFOP e NCM, que este sistema importou em massa por
--     migration (`import_cfop_codes_from_source`,
--     `import_ncm_codes_from_siscomex`) justamente por serem catálogos oficiais
--     sem restrição de uso.
--   - A tabela é **trimestral**. Uma cópia semeada nasceria a caminho de
--     vencer, e envelheceria em silêncio.
--
-- Então vale o segundo padrão deste motor, o de `tax_rules` e `mva_rules`:
-- **tabela vazia, alimentada pelo contador**, que tem o cadastro dele no IBPT
-- (ou a assinatura da API do instituto) e transcreve as linhas dos NCM que a
-- loja realmente vende.
--
-- ## A chave é NCM × UF **do emitente** — e é a diferença para `mva_rules`
--
-- A MVA é publicada pelo estado que **recebe** a mercadoria, daí
-- `mva_rules.uf_destino`. A tabela do IBPT é baixada **por UF da empresa
-- emitente** — o site pede a UF da empresa cadastrada e entrega um CSV por
-- estado —, e a coluna `estadual` daquele arquivo é a carga de ICMS do estado
-- em que a empresa está. Por isso a coluna aqui se chama `uf` e quem a alimenta
-- no motor é a UF da filial, não a do cliente. Copiar `uf_destino` de
-- `mva_rules` por simetria teria sido o erro fácil desta tarefa.
--
-- ## As quatro colunas de percentual espelham o arquivo do IBPT
--
-- O CSV do IBPT (`TabelaIBPTax`) traz `codigo; ex; tipo; descricao;
-- nacionalfederal; importadosfederal; estadual; municipal; vigenciainicio;
-- vigenciafim; chave; versao; fonte`. As quatro colunas de percentual daqui são
-- as quatro de lá, com os nomes traduzidos, para a transcrição ser cópia direta
-- e não interpretação. A federal é a única desdobrada em nacional e importada;
-- estadual e municipal valem para os dois casos, como no arquivo.
--
-- ## O que NÃO virou coluna, e por quê
--
--   - **`ex`** (exceção fiscal do NCM). `products` não guarda EX nenhum, então
--     não haveria como casá-la. O cadastro é por NCM puro.
--   - **`tipo`** (0 = NCM, 1 = NBS, 2 = LC 116). Este motor emite NF-e/NFC-e de
--     mercadoria; serviço e ISS não passam por aqui.
--   - **`chave`** (a chave que associa o arquivo baixado à empresa). É
--     credencial do cadastro do contador no IBPT, não dado fiscal — não tem por
--     que morar num cadastro que a aplicação inteira lê.
--   - **`descricao`**. `ncm_codes` (10.514 linhas) já tem a descrição oficial
--     do NCM; guardar uma segunda seria criar duas versões da mesma frase.
--   - **`vigenciafim`**. Ver `vigencia_inicio` abaixo: a vigência não filtra a
--     busca, então guardar as duas pontas seria sugerir um comportamento que
--     não existe.
--
-- ## O que esta migration NÃO faz
--
--   - Não semeia nenhum percentual. A tabela nasce vazia, e vazia significa
--     "nenhuma nota declara vTotTrib" — que é o comportamento de hoje. Nada
--     muda em nenhuma nota até alguém cadastrar a primeira linha.
--   - Não mexe em nenhum outro imposto. B9 é aditivo e isolado: nenhuma coluna
--     de ICMS, ST, IPI, PIS/COFINS ou DIFAL é tocada.

-- ---------------------------------------------------------------------
-- A tabela
-- ---------------------------------------------------------------------

create table if not exists public.ibpt_rates (
  id uuid primary key default gen_random_uuid(),
  ncm text not null,
  uf text not null,
  aliquota_nacional_federal numeric(7,4) not null,
  aliquota_importado_federal numeric(7,4) not null,
  aliquota_estadual numeric(7,4) not null,
  aliquota_municipal numeric(7,4) not null,
  fonte text,
  versao text,
  vigencia_inicio date,
  created_at timestamp with time zone not null default now()
);

comment on table public.ibpt_rates is
  'Percentuais aproximados de tributos por NCM x UF do emitente, para o vTotTrib da Lei 12.741/2012 (B9, 05/09/2026). Transcricao manual da tabela do IBPT ("De Olho no Imposto"), que nao e semeada aqui: o termo de uso do instituto a libera mediante cadastro do usuario e veda a comercializacao, e a tabela e trimestral. uf aceita o coringa * (mesmo padrao de tax_rules/mva_rules): mais especifico vence. Tabela vazia significa que nenhuma nota declara vTotTrib — e a ausencia do campo NAO recusa emissao, ao contrario de todo o resto do motor tributario. resolveIbptRate() (supabase/functions/_shared/fiscal/ibptRates.ts) le esta tabela.';

comment on column public.ibpt_rates.ncm is
  'NCM de 8 digitos, sem pontuacao (mesmo formato de products.ncm e de mva_rules.ncm). A comparacao no motor ignora pontuacao, entao 2202.10.00 e 22021000 casam — mas grave sem, para bater com o cadastro de Produtos.';
comment on column public.ibpt_rates.uf is
  'Sigla da UF da EMPRESA EMITENTE (a filial que vende), ou * para qualquer UF. Atencao: e a UF de origem, ao contrario de mva_rules.uf_destino. O IBPT publica um arquivo por UF, e o site pede a UF da empresa cadastrada — a coluna estadual daquele arquivo e a carga de ICMS do estado onde a empresa esta.';
comment on column public.ibpt_rates.aliquota_nacional_federal is
  'Coluna nacionalfederal do arquivo do IBPT, em percentual (0 a 100). Usada quando a mercadoria e nacional (products.origem_mercadoria 0, 4 ou 5).';
comment on column public.ibpt_rates.aliquota_importado_federal is
  'Coluna importadosfederal do arquivo do IBPT, em percentual (0 a 100). Usada quando products.origem_mercadoria e 1, 2, 3, 6, 7 ou 8 — estrangeira, ou nacional com Conteudo de Importacao acima de 40%. O corte sai do Decreto 8.264/2014, art. 3o, §2o (insumos de comercio exterior acima de 20% do preco de venda); ver origemMercadoriaImportadaParaIbpt em ibptRates.ts.';
comment on column public.ibpt_rates.aliquota_estadual is
  'Coluna estadual do arquivo do IBPT, em percentual (0 a 100). Vale para mercadoria nacional e importada — o arquivo nao a desdobra.';
comment on column public.ibpt_rates.aliquota_municipal is
  'Coluna municipal do arquivo do IBPT, em percentual (0 a 100). Vale para nacional e importada, como a estadual.';
comment on column public.ibpt_rates.fonte is
  'Coluna fonte do arquivo (na pratica, IBPT). Vai nas Informacoes Complementares da nota quando preenchida. NAO e exigencia legal: nem a Lei 12.741/2012 nem o Decreto 8.264/2014 mandam citar a fonte no documento fiscal — e pratica de mercado, e serve para saber de que tabela saiu o numero.';
comment on column public.ibpt_rates.versao is
  'Versao da tabela do IBPT transcrita (coluna versao do arquivo). Rastro de auditoria; acompanha a fonte nas Informacoes Complementares.';
comment on column public.ibpt_rates.vigencia_inicio is
  'Inicio da vigencia da versao transcrita (coluna vigenciainicio). NAO filtra a busca: nenhum cadastro deste motor tem dimensao temporal, e este seria o unico. Consequencia registrada: uma linha vencida continua produzindo vTotTrib com o percentual antigo, em vez de o campo sumir da nota sem ninguem perceber.';

-- Um percentual por NCM x UF (o coringa conta como uma UF): mesma garantia de
-- `mva_rules_dimensions_unique`, e é o que torna o desempate "mais específico
-- vence" determinístico. Aqui ela tem um papel extra: como o empate de
-- especificidade **não** recusa emissão (o campo é informativo), sem esta
-- constraint um cadastro duplicado faria o vTotTrib sumir em silêncio.
alter table public.ibpt_rates
  drop constraint if exists ibpt_rates_dimensions_unique;
alter table public.ibpt_rates
  add constraint ibpt_rates_dimensions_unique unique (ncm, uf);

-- Os quatro percentuais são 0–100, como toda alíquota percentual criada em B1
-- e B2. Não há teto folgado como o da MVA (300%): carga tributária aproximada
-- acima de 100% do preço de venda seria erro de digitação, não caso real.
alter table public.ibpt_rates
  drop constraint if exists ibpt_rates_aliquota_nacional_federal_check;
alter table public.ibpt_rates
  add constraint ibpt_rates_aliquota_nacional_federal_check
  check (aliquota_nacional_federal >= 0 and aliquota_nacional_federal <= 100);

alter table public.ibpt_rates
  drop constraint if exists ibpt_rates_aliquota_importado_federal_check;
alter table public.ibpt_rates
  add constraint ibpt_rates_aliquota_importado_federal_check
  check (aliquota_importado_federal >= 0 and aliquota_importado_federal <= 100);

alter table public.ibpt_rates
  drop constraint if exists ibpt_rates_aliquota_estadual_check;
alter table public.ibpt_rates
  add constraint ibpt_rates_aliquota_estadual_check
  check (aliquota_estadual >= 0 and aliquota_estadual <= 100);

alter table public.ibpt_rates
  drop constraint if exists ibpt_rates_aliquota_municipal_check;
alter table public.ibpt_rates
  add constraint ibpt_rates_aliquota_municipal_check
  check (aliquota_municipal >= 0 and aliquota_municipal <= 100);

-- O motor lê a tabela inteira de uma vez (`readIbptRates`), como já faz com
-- `tax_rules` e `mva_rules`, então o índice não serve à emissão — serve à tela,
-- que filtra por NCM, e ao dia em que a tabela crescer o bastante para a
-- leitura completa deixar de valer. E ela cresce mais que `mva_rules`: ST
-- alcança poucas mercadorias, a Lei da Transparência alcança todas.
create index if not exists ibpt_rates_lookup_idx on public.ibpt_rates using btree (ncm, uf);

-- ---------------------------------------------------------------------
-- RLS — as quatro policies separadas, no padrão de tax_rules/mva_rules
-- ---------------------------------------------------------------------
--
-- Nunca `for all`: ela duplicaria a cobertura do `select` e dispararia
-- "multiple permissive policies" no advisor (convenção do README de
-- migrations). Sem `has_branch_access`: a tabela não tem `branch_id`, pelo
-- mesmo motivo de `tax_rules`/`mva_rules` — a UF aqui é uma **dimensão de
-- busca**, cadastrada como dado, não o escopo de quem enxerga a linha. Uma
-- empresa com filiais em dois estados cadastra as duas UFs na mesma tabela.

alter table public.ibpt_rates enable row level security;

grant all on table public.ibpt_rates to anon;
grant all on table public.ibpt_rates to authenticated;
grant all on table public.ibpt_rates to service_role;

drop policy if exists "read ibpt_rates" on public.ibpt_rates;
create policy "read ibpt_rates" on public.ibpt_rates
  for select using (public.has_permission('tributos-aproximados', 'view'));

drop policy if exists "insert ibpt_rates" on public.ibpt_rates;
create policy "insert ibpt_rates" on public.ibpt_rates
  for insert with check (public.has_permission('tributos-aproximados', 'create'));

drop policy if exists "update ibpt_rates" on public.ibpt_rates;
create policy "update ibpt_rates" on public.ibpt_rates
  for update using (public.has_permission('tributos-aproximados', 'edit'));

drop policy if exists "delete ibpt_rates" on public.ibpt_rates;
create policy "delete ibpt_rates" on public.ibpt_rates
  for delete using (public.has_permission('tributos-aproximados', 'delete'));

-- ---------------------------------------------------------------------
-- O módulo `tributos-aproximados`
-- ---------------------------------------------------------------------
--
-- Conferido antes de escrever: o módulo **não existia** em `modules` nem em
-- `module_fields` — não há, hoje, nenhuma tela de IBPT/transparência fiscal no
-- sistema. Sem ele as policies acima recusariam tudo (`has_permission` de um
-- módulo inexistente é sempre falso) e ninguém teria como cadastrar um
-- percentual pela aplicação: a tabela ficaria inalcançável dos dois lados.
--
-- `storage_kind = 'table'` com `data_table = 'ibpt_rates'`: roda na
-- `GenericModulePage`, sem componente próprio, exatamente como `tributacoes`,
-- `grupos-tributarios` e `mva-icms-st`. `is_locked = true` porque é módulo de
-- sistema, `branch_scoped = false` porque a tabela não tem `branch_id`, e
-- `sort_order = 93` fica logo depois de `mva-icms-st` (92) na faixa dos
-- cadastros fiscais, sem renumerar nenhuma linha existente.

insert into public.modules
  (id, label, data_table, layout_variant, is_locked, path, icon_key,
   sort_order, show_on_home, access_gate, branch_scoped, storage_kind)
values
  ('tributos-aproximados', 'Tributos aproximados (IBPT)', 'ibpt_rates', 'three', true,
   '/tributos-aproximados', null, 93, true, 'permission', false, 'table')
on conflict (id) do nothing;

-- Nenhum campo aponta `reference_module_id`, pelas mesmas duas razões já
-- registradas em `mva_rules` (01/09/2026): `uf` aceita o coringa `*` (um campo
-- de referência só ofereceria siglas reais de `ufs` e apagaria o coringa em
-- silêncio na primeira edição), e `ncm` é texto livre porque `ncm_codes` nunca
-- virou módulo — em Produtos o NCM é resolvido por `SearchCombobox` via
-- `search_ncm_codes`, mecanismo que a `GenericModulePage` não tem. Consequência
-- prática, idêntica à de MVA: aqui o NCM é digitado. Como nenhuma linha tem
-- `reference_module_id`, o trigger `module_fields_guard_reference` não é
-- acionado.
--
-- `vigencia_inicio` é `date` de verdade (não texto): é o único campo do
-- cadastro que não é percentual nem sigla, e a tela ganha o seletor de data de
-- graça. As alíquotas são `text` pelo mesmo motivo que as de `mva-icms-st`: é
-- assim que a `GenericModulePage` trata número decimal hoje.

insert into public.module_fields
  (module_id, field_key, label, data_type, is_required, sort_order,
   show_in_table, table_width, table_align, show_in_details, show_in_form, hint)
values
  ('tributos-aproximados', 'ncm', 'NCM', 'text', true, 10,
   true, '140px', 'center', true, true,
   'NCM de 8 dígitos, sem pontuação (o mesmo que está no cadastro do produto).'),
  ('tributos-aproximados', 'uf', 'UF da empresa (ou * p/ qualquer)', 'text', true, 20,
   true, '170px', 'left', true, true,
   'Sigla do estado da SUA empresa — é a UF do arquivo que você baixou do IBPT, não a do cliente. Use * para valer em qualquer UF; uma linha com a UF exata vence a coringa.'),
  ('tributos-aproximados', 'aliquota_nacional_federal', 'Federal nacional (%)', 'text', true, 30,
   true, '150px', 'center', true, true,
   'Coluna "nacionalfederal" do arquivo do IBPT. Usada quando o produto tem origem nacional.'),
  ('tributos-aproximados', 'aliquota_importado_federal', 'Federal importado (%)', 'text', true, 40,
   true, '150px', 'center', true, true,
   'Coluna "importadosfederal" do arquivo do IBPT. Usada quando a origem do produto é estrangeira ou tem Conteúdo de Importação acima de 40%.'),
  ('tributos-aproximados', 'aliquota_estadual', 'Estadual (%)', 'text', true, 50,
   true, '130px', 'center', true, true,
   'Coluna "estadual" do arquivo do IBPT. Vale tanto para produto nacional quanto importado.'),
  ('tributos-aproximados', 'aliquota_municipal', 'Municipal (%)', 'text', true, 60,
   true, '130px', 'center', true, true,
   'Coluna "municipal" do arquivo do IBPT. Vale tanto para produto nacional quanto importado.'),
  ('tributos-aproximados', 'fonte', 'Fonte', 'text', false, 70,
   false, null, null, true, true,
   'De onde vieram os percentuais (normalmente "IBPT"). Sai nas Informações Complementares da nota. Não é exigido por lei — deixe vazio se preferir não citar.'),
  ('tributos-aproximados', 'versao', 'Versão da tabela', 'text', false, 80,
   false, null, null, true, true,
   'Versão da tabela do IBPT que você transcreveu. Acompanha a fonte nas Informações Complementares e serve de rastro para auditoria.'),
  ('tributos-aproximados', 'vigencia_inicio', 'Início da vigência', 'date', false, 90,
   false, null, null, true, true,
   'Início da vigência da versão transcrita. É só registro: o sistema não deixa de usar a linha depois que ela vence — quem atualiza a tabela trimestral é você.')
on conflict (module_id, field_key) do nothing;

-- Quem já podia cadastrar grupos tributários passa a poder cadastrar os
-- percentuais da Lei da Transparência: é o mesmo trabalho (o cadastro fiscal
-- que alimenta a emissão), feito pela mesma pessoa. Copiar a permissão
-- existente, em vez de fixar um papel pelo nome, mantém a migration correta em
-- qualquer ambiente — inclusive num banco recriado do zero, onde os uuid dos
-- papéis são outros. Mesmo critério de B2.
insert into public.role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
select rp.role_id, 'tributos-aproximados', rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
from public.role_permissions rp
where rp.module_id = 'grupos-tributarios'
on conflict (role_id, module_id) do nothing;

-- ---------------------------------------------------------------------
-- As duas colunas de `vTotTrib` no documento fiscal
-- ---------------------------------------------------------------------
--
-- Ao contrário de B2 — em que as colunas de ST já existiam desde A3 e só
-- faltava quem as preenchesse —, aqui **não havia onde guardar**: A3 modelou o
-- documento canônico com uma coluna por imposto, e o `vTotTrib` não é imposto.
-- São duas colunas novas, uma no item e uma no cabeçalho, com o mesmo par
-- item/total que o XML tem.
--
-- **Esta migration vem ANTES do deploy da `fiscal-emit`**, pelo motivo de
-- sempre (registrado desde B5): `persist.ts` manda as duas colunas no insert
-- mesmo nulas, e sem elas o PGRST204 estoura **depois** de a SEFAZ já ter
-- autorizado, em toda nota — não só nas que declaram vTotTrib. `data.ts`
-- também passa a ler `ibpt_rates`, e PostgREST responde 400 para tabela
-- inexistente, o que derrubaria a emissão inteira.

alter table public.fiscal_document_items
  add column if not exists valor_tributos_aproximados numeric(14,2);

comment on column public.fiscal_document_items.valor_tributos_aproximados is
  'vTotTrib do item (id M02) — valor aproximado dos tributos federais, estaduais e municipais da Lei 12.741/2012 (B9, 05/09/2026). Nao e imposto devido: o Decreto 8.264/2014, art. 6o, diz que tem "carater meramente informativo". Nula quando o NCM nao tem linha em ibpt_rates, o que NAO impede a emissao — e a unica coluna deste modelo cuja ausencia de cadastro nao recusa a nota. numeric(14,2) como as demais colunas de valor, e Decimal[13.2] no leiaute.';

alter table public.fiscal_documents
  add column if not exists total_tributos_aproximados numeric(14,2);

comment on column public.fiscal_documents.total_tributos_aproximados is
  'vTotTrib do grupo total/ICMSTot (id W16a) — soma dos valor_tributos_aproximados dos itens (B9, 05/09/2026). A igualdade com a soma dos itens e exigida sem tolerancia: divergencia e rejeicao 685. NAO entra em total_nota, ao contrario do IPI e do ICMS-ST — nao e imposto acrescido ao documento, e sim estimativa do que ja esta no preco. Nula em toda nota que nao e venda ao consumidor (devolucao, e NF-e com consumidor_final = 0).';
