-- B5 — PIS/COFINS por unidade de medida: o CST 03 e a alíquota ad rem (01/09/2026)
--
-- Terceira tarefa da Etapa 2 do "Mínimo pra vender". B1 ensinou o motor a
-- calcular o ICMS próprio, o IPI e a redução de base, e a **parar de declarar**
-- valor nos CST cujo grupo XML não tem onde escrevê-lo. B2 acrescentou o
-- ICMS-ST. B5 fecha a única forma de tributar que o motor ainda não conhecia:
-- **por unidade de medida**, o regime ad rem do PIS e da COFINS.
--
-- ## O caso que faltava, e por que ele não é um percentual diferente
--
-- O CST 03 da tabela 4.3.3 ("Operação Tributável com Alíquota por Unidade de
-- Medida de Produto") cai no grupo XML `PISQtde`/`COFINSQtde`, que tem três
-- campos: `qBCProd` (quantidade vendida), `vAliqProd` (a alíquota **em reais
-- por unidade**) e `vPIS`/`vCOFINS`. Ele **não tem** `vBC` nem `pPIS` — não é
-- um percentual sobre a receita, é um valor fixo por litro/unidade fixado em
-- lei. É o regime dos combustíveis e do álcool, das bebidas frias e das
-- embalagens para bebidas frias.
--
-- Até aqui o motor só sabia calcular percentual, e por isso B1 pôs o `03` na
-- lista dos CST que não declaram valor — com o comentário dizendo que "quem
-- ensina o motor a calcular por unidade é B5". O desfecho não era errado (não
-- escrevia percentual num grupo que não o aceita), mas era **incompleto**: um
-- item ad rem saía sem PIS/COFINS nenhum. Esta migration cria o cadastro que
-- faltava e as colunas que guardam o que foi declarado.
--
-- Fórmula, conferida contra o Manual de Orientação do Contribuinte (leiaute
-- 4.00) e a tabela de campos da Focus NFe antes de implementar:
--
--     vPIS = qBCProd x vAliqProd
--
-- (exemplo do próprio manual: 1000 unidades x R$ 0,0076 = R$ 7,60 — aqui
-- arredondado a centavos, o mesmo critério de todo valor de imposto do motor).
--
-- ## Por que duas colunas novas em `tax_groups`, e não reaproveitar as antigas
--
-- `aliquota_pis` e `aliquota_cofins` são **percentuais** (`pPIS`, de 0 a 100).
-- A alíquota ad rem é em reais e não tem teto de 100 — R$ 0,0076 por unidade e
-- R$ 5,00 por litro são a mesma coluna. Guardar as duas no mesmo campo
-- obrigaria o motor a adivinhar a unidade do número pelo CST, e um cadastro
-- lido com a interpretação errada produz nota autorizada com imposto errado.
-- Duas colunas dizem qual é qual sem ambiguidade; quem escolhe entre elas é o
-- CST, não o preenchimento.
--
-- Um mesmo grupo pode ter as duas preenchidas sem se contradizer — ele serve a
-- produtos, e o CST de cada linha decide o caminho. Por isso não há `check`
-- amarrando uma à outra.
--
-- ## Precisão e faixa
--
-- `numeric(15,4)`, e não o `numeric(7,4)` das alíquotas percentuais de B1/B2:
--
--   - 4 casas decimais são o que `vAliqProd` admite no leiaute (Decimal com 0 a
--     4 decimais), e é onde as alíquotas reais vivem — R$ 0,0076 por unidade é
--     valor de tabela, não caso de borda.
--   - a parte inteira é maior de propósito. As colunas percentuais cabem em
--     999,9999 porque percentual acima de 100 já é cadastro errado; reais por
--     unidade não têm esse teto natural.
--   - **é a mesma precisão das colunas correspondentes em
--     `fiscal_document_items`** (abaixo), e isso é o que impede o modo de falha
--     que B2 documentou: um valor que cabe no cadastro mas estoura a coluna do
--     item faria a gravação falhar **depois** de a SEFAZ ter autorizado a nota.
--     Cadastro e item com a mesma precisão tornam isso impossível.
--
-- `check` de **não-negativo apenas**, sem limite superior: alíquota negativa
-- por unidade não existe (produziria imposto negativo, que o leiaute não
-- aceita), mas qualquer teto superior seria um número inventado — a lei fixa
-- esses valores em reais e nada impede que um dia sejam altos.
--
-- ## ORDEM DE APLICAÇÃO: esta migration vem ANTES do deploy da `fiscal-emit`
--
-- Ao contrário da migration 4 (A1), que só removia coisas e por isso vinha
-- depois do deploy, esta **precisa estar aplicada antes** de a Edge Function
-- com o código de B5 subir. São dois pontos, e os dois derrubam a emissão
-- inteira, não só a dos itens com CST 03:
--
--   - `data.ts` monta o `select` da venda com `TAX_GROUP_COLUMNS`, que passou a
--     listar `aliquota_pis_valor` e `aliquota_cofins_valor`. Sem as colunas, o
--     PostgREST responde 400 ("column does not exist") e nenhuma nota é
--     montada.
--   - `persist.ts` sempre manda as quatro colunas novas de
--     `fiscal_document_items` no insert, mesmo nulas. Sem elas, o insert falha
--     com PGRST204 — e falha **depois** de o cabeçalho estar gravado e a SEFAZ
--     ter autorizado, caindo na mensagem "a nota foi autorizada, mas houve
--     falha ao gravar o detalhe" em toda venda.
--
-- Ordem correta: aplicar as migrations 5 (B1), 6 (B2) e 7 (B5) → implantar
-- `fiscal-emit`. As três são aditivas e não quebram a função que está
-- implantada hoje, que simplesmente não conhece as colunas novas.
--
-- ## O que esta migration NÃO faz
--
--   - Não mexe em RLS. `tax_groups` já tem as quatro policies de
--     `grupos-tributarios` desde 19/08/2026, e policy é por linha, não por
--     coluna — mesma constatação registrada em B1.
--   - Não semeia nenhum valor. As colunas nascem nulas em todos os grupos e em
--     todas as notas já emitidas; nulo continua significando "não calculado".
--     Enquanto ninguém cadastrar uma alíquota ad rem, nenhuma nota muda.
--   - Não toca no CST 04 (revenda monofásica a alíquota zero), que já sai
--     correto desde B1 — ver a entrada de B5 no AGENTS.md, onde a pesquisa
--     sobre monofásico está registrada.

-- ---------------------------------------------------------------------
-- Cadastro: a alíquota em reais por unidade, no grupo tributário
-- ---------------------------------------------------------------------

alter table public.tax_groups
  add column if not exists aliquota_pis_valor numeric(15,4),
  add column if not exists aliquota_cofins_valor numeric(15,4);

alter table public.tax_groups
  drop constraint if exists tax_groups_aliquota_pis_valor_check;
alter table public.tax_groups
  add constraint tax_groups_aliquota_pis_valor_check
  check (aliquota_pis_valor is null or aliquota_pis_valor >= 0);

alter table public.tax_groups
  drop constraint if exists tax_groups_aliquota_cofins_valor_check;
alter table public.tax_groups
  add constraint tax_groups_aliquota_cofins_valor_check
  check (aliquota_cofins_valor is null or aliquota_cofins_valor >= 0);

comment on column public.tax_groups.aliquota_pis_valor is
  'vAliqProd do grupo PISQtde: aliquota de PIS em REAIS POR UNIDADE (regime ad rem), nao em percentual. Usada apenas pelos itens com CST de PIS 03; o calculo e quantidade vendida x este valor. Nula significa que o grupo nao tributa PIS por unidade — cadastrar CST 03 sem ela recusa a emissao com mensagem propria. E coluna separada de aliquota_pis (que e percentual, 0 a 100) de proposito: sao unidades diferentes, e adivinhar qual esta preenchida pelo CST produziria nota com imposto errado.';
comment on column public.tax_groups.aliquota_cofins_valor is
  'vAliqProd do grupo COFINSQtde: aliquota de COFINS em REAIS POR UNIDADE (regime ad rem). Ver aliquota_pis_valor — mesma regra, tratada independentemente: nada impede um grupo com PIS ad rem e COFINS percentual.';

comment on table public.tax_groups is
  'Grupo tributario: perfil nomeado e reutilizavel de CST/CSOSN, aliquotas e reducao de base, atrelado ao produto (products.tax_group_id). Correcao da etapa 7: CFOP e da operacao (tax_rules), CST/aliquota sao do produto. IPI (CST + aliquota) entrou em B1 e as aliquotas ad rem de PIS/COFINS em B5, as duas em 01/09/2026. Nao isolada por filial.';

-- ---------------------------------------------------------------------
-- Documento: o que o grupo PISQtde/COFINSQtde declarou
-- ---------------------------------------------------------------------
--
-- `fiscal_document_items` guarda o **snapshot do que foi declarado** (A3), e
-- as colunas de PIS/COFINS que existem desde lá cobrem só o caminho percentual
-- (`pis_base` = vBC, `pis_aliquota` = pPIS, `pis_valor` = vPIS). O caminho por
-- unidade declara outros dois campos, e sem colunas proprias eles se perderiam:
-- a nota diria R$ 7,60 de PIS sem registrar de onde saiu.
--
-- Os nomes replicam os do payload (que por sua vez espelha a Focus NFe, como
-- `types.ts` documenta desde a etapa F1) e ficam ao lado dos parentes
-- percentuais: `pis_quantidade_vendida`/`pis_aliquota_valor` convivem com
-- `pis_base`/`pis_aliquota`, e **nunca os quatro na mesma linha** — o grupo
-- `PISQtde` nao tem os campos percentuais, e o `PISOutr` (CST 49 a 99) trata as
-- duas formas como escolha exclusiva no schema. Quem garante isso e
-- `resolvePisCofins`, no nucleo; aqui o par que nao vale fica nulo.
--
-- `numeric(15,4)` nas quatro: a quantidade acompanha `quantidade_comercial` e
-- `quantidade_tributavel` (as duas ja `numeric(15,4)` desde A3, e `qBCProd` e
-- Decimal de ate 4 decimais), e a aliquota acompanha o cadastro de onde ela
-- vem.

alter table public.fiscal_document_items
  add column if not exists pis_quantidade_vendida numeric(15,4),
  add column if not exists pis_aliquota_valor numeric(15,4),
  add column if not exists cofins_quantidade_vendida numeric(15,4),
  add column if not exists cofins_aliquota_valor numeric(15,4);

comment on column public.fiscal_document_items.pis_quantidade_vendida is
  'qBCProd do grupo PISQtde (CST 03): a quantidade vendida que serve de base ao PIS ad rem. Preenchida por B5, 01/09/2026. Nula nos itens que seguiram o caminho percentual — nesses valem pis_base e pis_aliquota. Sai na quantidade COMERCIAL do item: este sistema nao guarda fator de conversao entre products.unidade_comercial e products.unidade_tributavel, limitacao registrada na entrada de B5 do AGENTS.md.';
comment on column public.fiscal_document_items.pis_aliquota_valor is
  'vAliqProd do grupo PISQtde: aliquota de PIS em reais por unidade, copiada de tax_groups.aliquota_pis_valor no momento da emissao. Nao confundir com pis_aliquota, que e o percentual pPIS. vPIS = pis_quantidade_vendida x pis_aliquota_valor.';
comment on column public.fiscal_document_items.cofins_quantidade_vendida is
  'qBCProd do grupo COFINSQtde (CST 03). Ver pis_quantidade_vendida.';
comment on column public.fiscal_document_items.cofins_aliquota_valor is
  'vAliqProd do grupo COFINSQtde: aliquota de COFINS em reais por unidade. Ver pis_aliquota_valor.';

-- ---------------------------------------------------------------------
-- Os dois campos na tela de Grupos tributarios
-- ---------------------------------------------------------------------
--
-- Mesmo motivo de B1: `grupos-tributarios` roda na GenericModulePage
-- (storage_kind = 'table', sem componente proprio), entao coluna sem linha em
-- `module_fields` e coluna que ninguem consegue preencher pela aplicacao — B5
-- ficaria sem meio de uso.
--
-- `data_type: 'text'` acompanha todas as outras aliquotas, que sao text no
-- motor generico desde 19/08/2026 (o achado sobre campo numerico no motor esta
-- registrado no AGENTS.md daquele dia).
--
-- `sort_order` 75 e 91 sao intermediarios de proposito, para nenhuma linha
-- existente precisar ser renumerada: cada aliquota ad rem fica logo depois da
-- aliquota percentual do mesmo imposto (a de PIS em 70, a de COFINS em 90), que
-- e onde quem cadastra espera encontra-la. 91 e nao 95 porque B1 ja ocupou
-- 95/96 com o CST e a aliquota de IPI.
--
-- Os dois ficam fora da lista (`show_in_table = false`), como todos os campos
-- de PIS/COFINS ja sao — a tabela ja mostra cinco colunas.

insert into public.module_fields
  (module_id, field_key, label, data_type, is_required, sort_order, show_in_table, show_in_details, show_in_form, hint)
values
  ('grupos-tributarios', 'aliquota_pis_valor', 'Alíquota PIS por unidade (R$)', 'text', false, 75, false, true, true,
   'Valor em REAIS por unidade vendida (vAliqProd), não percentual. Use apenas com CST de PIS 03 (alíquota por unidade de medida — combustíveis, bebidas frias e afins). Deixe vazio quando o PIS for percentual.'),
  ('grupos-tributarios', 'aliquota_cofins_valor', 'Alíquota COFINS por unidade (R$)', 'text', false, 91, false, true, true,
   'Valor em REAIS por unidade vendida (vAliqProd), não percentual. Use apenas com CST de COFINS 03. Deixe vazio quando a COFINS for percentual.')
on conflict (module_id, field_key) do nothing;
