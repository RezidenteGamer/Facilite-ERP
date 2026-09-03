-- B8 — Simples Nacional: o credito de ICMS do CSOSN 101/201 (03/09/2026)
--
-- Quarta tarefa da Etapa 2 do "Minimo pra vender". B1 ensinou o motor a
-- calcular o ICMS proprio, o IPI e a reducao de base, e a parar de declarar
-- valor nos CST cujo grupo XML nao tem onde escreve-lo. B2 acrescentou o
-- ICMS-ST. B5 fechou o PIS/COFINS ad rem. B8 fecha a parte do Simples Nacional
-- que as tres deixaram anotada como pendente.
--
-- ## O que faltava, e por que nao e uma aliquota como as outras
--
-- O optante pelo Simples Nacional paga o ICMS embutido no DAS e, por isso,
-- **nao destaca `vICMS`** na nota: desde B1 nenhum CSOSN (a nao ser o 900)
-- declara base, aliquota nem valor de ICMS proprio. Sem mais nada, o comprador
-- de Regime Normal nao teria credito de nada.
--
-- O leiaute resolve isso com dois campos que existem **so** no Simples:
--
--   pCredSN     - a aliquota aplicavel de calculo do credito, em percentual
--   vCredICMSSN - o valor do credito que o destinatario pode aproveitar nos
--                 termos do art. 23 da LC 123/2006
--
-- A conta e `vCredICMSSN = valor da operacao x pCredSN / 100`. A base e o
-- **valor da operacao**, e nao uma base de calculo de ICMS: o grupo `ICMSSN101`
-- tem exatamente quatro campos (`orig`, `CSOSN`, `pCredSN`, `vCredICMSSN`) e
-- nao tem `vBC` nenhum. Conferido contra a tabela de campos do leiaute 4.00 e
-- contra a tabela de campos da Focus NFe antes de desenhar qualquer coluna.
--
-- Nos grupos `ICMSSN101` e `ICMSSN201` os dois campos sao **obrigatorios** (`S`
-- na tabela de campos), e e isso que decide o comportamento do motor quando o
-- cadastro esta incompleto: recusa, em vez de campo ausente. Ver a nota sobre a
-- recusa mais abaixo.
--
-- ## POR QUE A COLUNA VAI EM `branches`, E NAO EM `tax_groups`
--
-- Esta e a decisao de arquitetura da tarefa, e ela contraria o padrao das tres
-- anteriores de proposito: B1, B2 e B5 puseram tudo em `tax_groups` (ou, no
-- caso da MVA, numa tabela nova por NCM x UF). Aqui nao serve nenhum dos dois.
--
-- `pCredSN` **nao e atributo do produto**. E o percentual efetivo de ICMS
-- dentro da aliquota composta do Simples Nacional, calculado sobre a faixa de
-- receita bruta dos ultimos 12 meses (RBT12) em que o **estabelecimento** esta
-- enquadrado, pela formula da Resolucao CGSN 140/2018, art. 60:
--
--   {[(RBT12 x aliquota nominal) - parcela a deduzir] / RBT12}
--     x percentual de distribuicao do ICMS do Anexo
--
-- Nada nessa formula fala de mercadoria. Quem tem CNPJ, Anexo e faixa de
-- receita e a filial, e o mesmo percentual vale para **toda nota que ela emite
-- naquele mes**, seja de que produto for. Guardar isso em `tax_groups` obrigaria
-- a repetir o mesmo numero em todos os grupos e a atualizar todos eles a cada
-- virada de faixa — cadastro descrevendo uma dimensao que ele nao tem, e a
-- primeira divergencia entre duas linhas produziria duas notas com creditos
-- diferentes para o mesmo vendedor no mesmo mes.
--
-- **O calculo automatico do RBT12 e do enquadramento esta fora de escopo**, por
-- decisao registrada em B8: seria um modulo de apuracao a parte, com serie
-- historica de receita por filial. O numero e cadastrado a mao, e muda quando o
-- contador disser que mudou.
--
-- ## O que esta migration NAO faz
--
--   - **Nao cria modulo `filiais` nem linhas em `module_fields`.** Conferido em
--     `modules` antes de escrever: nao existe modulo de filiais, e nunca
--     existiu — `branches` e cadastro so por SQL, com `access_gate`
--     `manage_branches` e RLS propria (`can_manage_branches()`), e a unica tela
--     que a toca e o seletor de filial (`BranchesModal`, que so le). Criar um
--     CRUD de filiais pela `GenericModulePage` seria expor a tabela que sustenta
--     a multiempresa inteira, o que e tarefa propria e de outro risco.
--     O meio de uso desta coluna e uma secao nova em **Configuracoes**,
--     escopada pela filial ativa e protegida por `can_manage_branches` — o
--     mesmo desenho que `allow_negative_stock` (`StockPolicySection`) ja usa
--     desde 18/08/2026. Front, portanto, e nao `module_fields`.
--   - **Nao mexe em RLS.** `branches` ja tem as policies de
--     `can_manage_branches()` desde o baseline, e `fiscal_document_items` ja e
--     escrita so pela Edge Function (A1). Policy e por linha, nao por coluna —
--     mesma constatacao de B1 e B5.
--   - **Nao semeia valor nenhum.** A coluna nasce nula em todas as filiais.
--     Enquanto ninguem cadastrar, nada muda para filial de Regime Normal e para
--     qualquer CSOSN que nao seja 101 ou 201.
--   - **Nao toca no CSOSN 900.** O grupo `ICMSSN900` tambem aceita
--     `pCredSN`/`vCredICMSSN`, mas como opcional (`?` na tabela de campos: "a
--     exigencia depende da situacao fatica"). Como a aliquota e da filial e vale
--     para toda nota, incluir o catch-all faria o credito ser declarado
--     automaticamente em operacoes que o contador marcou justamente como
--     "nenhuma das anteriores". Ver `taxSituations.ts`.
--
-- ## ORDEM DE APLICACAO: esta migration vem ANTES do deploy da `fiscal-emit`
--
-- Mesmo motivo de B5, e pelos mesmos dois pontos:
--
--   - `data.ts` passou a listar `aliquota_credito_icms_simples` no `select` da
--     filial (nas duas consultas, venda e devolucao). Sem a coluna, o PostgREST
--     responde 400 e **nenhuma** nota e montada.
--   - `persist.ts` manda as duas colunas novas de `fiscal_document_items` no
--     insert mesmo nulas. Sem elas, PGRST204 — e falha **depois** de a SEFAZ ter
--     autorizado, caindo em "a nota foi autorizada, mas houve falha ao gravar o
--     detalhe" em toda venda.
--
-- Ordem correta: aplicar 5 (B1), 6 (B2), 7 (B5) e 8 (B8) -> implantar
-- `fiscal-emit`. As quatro sao aditivas e nao quebram a funcao implantada hoje.

-- ---------------------------------------------------------------------
-- Cadastro: a aliquota de credito, na filial
-- ---------------------------------------------------------------------
--
-- `numeric(7,4)` acompanha as demais aliquotas percentuais do sistema
-- (`tax_groups.aliquota_icms`, `reducao_base_icms`, `aliquota_ipi`) e cabe
-- exatamente no que o leiaute admite para `pCredSN`: `Decimal[3.2-4]`, isto e,
-- no maximo 999,9999 com 2 a 4 decimais. Os 4 decimais importam de verdade
-- aqui: a formula do art. 60 quase nunca da numero redondo (1,2500%, 2,3987%).
--
-- `check` de 0 a 100 — ao contrario de `aliquota_icms`, que nasceu em
-- 19/08/2026 sem constraint e por isso precisou de recusa em codigo (B2). Aqui
-- a coluna e nova e nao ha dado em producao, entao a constraint pode nascer com
-- ela. O motor recusa **tambem** fora da faixa, porque um credito absurdo e
-- imposto transferido a mais e a validacao dupla custa duas linhas.

alter table public.branches
  add column if not exists aliquota_credito_icms_simples numeric(7,4);

alter table public.branches
  drop constraint if exists branches_aliquota_credito_icms_simples_check;
alter table public.branches
  add constraint branches_aliquota_credito_icms_simples_check
  check (aliquota_credito_icms_simples is null
         or (aliquota_credito_icms_simples >= 0 and aliquota_credito_icms_simples <= 100));

comment on column public.branches.aliquota_credito_icms_simples is
  'pCredSN: aliquota aplicavel de calculo do credito de ICMS do Simples Nacional desta filial, em PERCENTUAL. E o percentual efetivo de ICMS da faixa de RBT12 em que a filial estava no mes ANTERIOR ao da operacao, pela formula do art. 60 da Resolucao CGSN 140/2018 - depende do Anexo e da receita da filial, nunca do produto, e por isso mora aqui e nao em tax_groups. Cadastro MANUAL: este sistema nao apura RBT12 nem enquadramento (fora de escopo por decisao de B8, 03/09/2026). Usada pelos itens com CSOSN 101 ou 201, onde o leiaute exige pCredSN e vCredICMSSN; nula recusa a emissao desses CSOSN com mensagem propria, porque os campos sao obrigatorios nesses grupos XML. Filial de Regime Normal e filial que usa CSOSN sem permissao de credito (102/202) nao precisam dela.';

-- ---------------------------------------------------------------------
-- Documento: o que o grupo ICMSSN101/ICMSSN201 declarou
-- ---------------------------------------------------------------------
--
-- `fiscal_document_items` guarda o snapshot **do que foi declarado** (A3). As
-- nove colunas de ST e as tres de FCP ja existiam desde la e B2 so passou a
-- preenche-las; estas duas nao existiam, porque nenhuma tarefa anterior
-- declarava credito de Simples. Sem elas a nota diria um credito no XML sem
-- registrar de onde saiu, e o percentual do mes seria irrecuperavel depois da
-- primeira virada de faixa da filial — que e justamente o dado que uma
-- fiscalizacao pediria.
--
-- Os nomes replicam os do payload (que espelha o corpo JSON da Focus NFe desde
-- a etapa F1: `icms_aliquota_credito_simples`, `icms_valor_credito_simples`),
-- mesma regra que B5 seguiu.
--
-- Precisoes, pelo mesmo criterio de B5 (cadastro e item com a mesma precisao,
-- para nenhum valor caber no cadastro e estourar a coluna do item **depois** de
-- a SEFAZ autorizar):
--
--   - a aliquota e `numeric(7,4)`, igual a coluna de `branches` de onde e
--     copiada;
--   - o valor e `numeric(15,2)`, igual as demais colunas de valor de imposto
--     desta tabela (`icms_valor`, `icms_st_valor`, `fcp_valor`), e o leiaute
--     define `vCredICMSSN` como Decimal[13.2].

alter table public.fiscal_document_items
  add column if not exists icms_aliquota_credito_simples numeric(7,4),
  add column if not exists icms_valor_credito_simples numeric(15,2);

comment on column public.fiscal_document_items.icms_aliquota_credito_simples is
  'pCredSN do grupo ICMSSN101/ICMSSN201: a aliquota de credito do Simples Nacional COPIADA DE branches.aliquota_credito_icms_simples no momento da emissao. Preenchida por B8, 03/09/2026. Guardada aqui, e nao recalculada depois, porque o percentual da filial muda a cada virada de faixa de RBT12 e a nota tem de continuar dizendo o que declarou. Nula nos itens que nao sao CSOSN 101 nem 201.';
comment on column public.fiscal_document_items.icms_valor_credito_simples is
  'vCredICMSSN: o valor do credito de ICMS que o destinatario pode aproveitar nos termos do art. 23 da LC 123/2006. E valor_bruto x icms_aliquota_credito_simples / 100 - a base e o VALOR DA OPERACAO, nao uma base de calculo de ICMS (o grupo ICMSSN101 nao tem vBC, e nenhum CSOSN alem do 900 declara icms_base). Nao confundir com icms_valor, que e o vICMS destacado pelo Regime Normal: o optante nao destaca ICMS proprio, e este campo e o substituto dele para efeito de credito do comprador.';

comment on table public.branches is
  'Filial (estabelecimento) - sustenta a multiempresa e e o emitente de toda nota fiscal. Cadastro so por SQL: nao ha modulo de filiais, e o que a aplicacao expoe sao parametros por filial em Configuracoes (allow_negative_stock desde 18/08/2026, aliquota_credito_icms_simples desde B8, 03/09/2026), todos protegidos por can_manage_branches().';
