-- B4 — DIFAL da EC 87/2015: o grupo ICMSUFDest e o FCP da operacao propria (04/09/2026)
--
-- Quinta tarefa da Etapa 2 do "Minimo pra vender", e a que fecha a metade que
-- a correcao da aliquota interestadual (04/09/2026) deixou aberta de proposito.
--
-- Aquela correcao ensinou o item a destacar o ICMS da venda interestadual pela
-- aliquota da Resolucao do Senado 22/1989 (7%/12%) ou 13/2012 (4%). A partir
-- do momento em que a nota destaca a aliquota INTERESTADUAL, existe a
-- diferenca entre ela e a aliquota interna do estado de destino — e o art.
-- 155, §2º, VII, da Constituicao, na redacao da EC 87/2015, diz de quem essa
-- diferenca e: "nas operacoes e prestacoes que destinem bens e servicos a
-- consumidor final, contribuinte ou nao do imposto, localizado em outro
-- Estado, adotar-se-a a aliquota interestadual e cabera ao Estado de
-- localizacao do destinatario o imposto correspondente a diferenca entre a
-- aliquota interna do Estado destinatario e a aliquota interestadual".
--
-- No XML isso e o grupo `ICMSUFDest`, e a regra de validacao `NA01-20` o EXIGE
-- quando `idDest = 2` (interestadual), `indFinal = 1` (consumidor final) e
-- `indIEDest = 9` (nao contribuinte) valem juntos. Sem o grupo, rejeicao 694.
-- Como a correcao da Rejeicao 696 (04/09/2026) fez toda venda a CNPJ sem IE
-- passar a declarar `indFinal = 1`, essa combinacao deixou de ser teorica: a
-- venda interestadual a nao contribuinte estava trocando a rejeicao 696 pela
-- 694, e e B4 que a destrava.
--
-- ## O que esta migration NAO cria, e e a decisao de escopo da tarefa
--
-- **Nao cria tabela de aliquota interna por UF x NCM.** O `pICMSUFDest` (a
-- aliquota interna do estado de destino) continua aproximado por
-- `tax_groups.aliquota_icms`, exatamente a mesma proxy com que B2 calcula a
-- base do ICMS-ST, e com a mesma ressalva registrada no AGENTS.md. A ressalva
-- pesa mais aqui, porque o DIFAL *e* a diferenca entre duas aliquotas — e ela
-- segue sendo a lacuna de raiz do ICMS deste motor, candidata numero um da
-- proxima tarefa que tocar no assunto. Inventar uma tabela de 27 UFs sem fonte
-- confiavel continua sendo pior que a aproximacao anotada.
--
-- **Nao cria cadastro de FCP.** O `pFCPUFDest` sai de `mva_rules.fcp_aliquota`
-- — a coluna que B2 criou para o `pFCPST` —, e nao e reaproveitamento
-- oportunista: e literalmente o mesmo numero. O Fundo de Combate a Pobreza e
-- percentual do estado de DESTINO, publicado por NCM nos mesmos protocolos, e
-- nao muda conforme o imposto seja retido por substituicao tributaria ou
-- devido por diferencial de aliquota. O que muda e a tag em que ele sai:
-- `pFCPST` num caso, `pFCPUFDest` no outro. Uma segunda tabela seria uma
-- segunda fonte de verdade para o mesmo fato.
--
-- Consequencia registrada: a tarefa `B3` (FCP) fica ENCERRADA por esta. B2 ja
-- calculava o FCP retido por ST desde 01/09/2026; o que faltava era o FCP da
-- operacao propria, que e o `pFCPUFDest`/`vFCPUFDest` de que B4 precisa.
--
-- **Nao cria coluna de finalidade da aquisicao.** O DIFAL da EC 87/2015
-- alcanca consumidor final "contribuinte ou nao", e este motor so o calcula
-- para o nao contribuinte (`indIEDest = 9`), porque e o unico caso que o
-- cadastro responde com confianca. A pesquisa do art. 23, §1º (04/09/2026) ja
-- decidiu, com fonte, que a destinacao da mercadoria e atributo DA AQUISICAO e
-- nao do cadastro do cliente, e que um campo por cliente seria pior que a
-- lacuna. Fica como limitacao conhecida, com a correcao certa ja apontada la:
-- um indicador de finalidade da aquisicao POR VENDA.
--
-- **Nao mexe em RLS.** `fiscal_documents` e `fiscal_document_items` ja sao
-- escritas so pela Edge Function desde A1, e policy e por linha, nao por
-- coluna — mesma constatacao de B1, B5 e B8.
--
-- ## ORDEM DE APLICACAO: esta migration vem ANTES do deploy da `fiscal-emit`
--
-- Mesmo motivo de B5 e B8, e por um ponto so desta vez: `persist.ts` manda as
-- doze colunas novas no insert mesmo nulas. Sem elas, PGRST204 — e a falha
-- acontece DEPOIS de a SEFAZ ter autorizado a nota, caindo em "a nota foi
-- autorizada, mas houve falha ao gravar o detalhe" em TODA venda, e nao apenas
-- nas interestaduais. `data.ts` nao mudou: B4 nao le nenhuma coluna nova (a
-- `mva_rules.fcp_aliquota` ja e lida desde B2).
--
-- Ordem correta: aplicar 5 (B1), 6 (B2), 7 (B5), 8 (B8), 9 (regime do cliente)
-- e 10 (B4) -> implantar `fiscal-emit`. Todas sao aditivas.

-- ---------------------------------------------------------------------
-- 1. fiscal_document_items — o que o grupo ICMSUFDest declarou
-- ---------------------------------------------------------------------
--
-- Nove colunas, nenhuma preexistente: ao contrario das de ICMS-ST e FCP-ST
-- (que A3 ja tinha criado e B2 so passou a preencher), nada em A3 previa
-- partilha de ICMS com a UF de destino.
--
-- Precisoes pelo criterio ja fixado por B5 e B8 — cadastro e item com a mesma
-- precisao, para nenhum valor caber no cadastro e estourar a coluna do item
-- DEPOIS de a SEFAZ autorizar:
--
--   - valores em `numeric(14,2)`, igual as demais colunas de valor de imposto
--     desta tabela (`icms_valor`, `icms_st_valor`, `fcp_valor`); o leiaute
--     define vBCUFDest/vICMSUFDest/vICMSUFRemet/vFCPUFDest como Decimal[13.2];
--   - aliquotas em `numeric(7,4)`, igual a `icms_aliquota`/`fcp_aliquota` e a
--     `tax_groups.aliquota_icms`, de onde a interna do destino e copiada.
--
-- As DUAS aliquotas sao gravadas junto dos valores, e nao so os valores, pelo
-- mesmo motivo de B8: a interna do destino e uma aproximacao do cadastro de
-- hoje, e a nota tem de continuar dizendo com que numero ela calculou depois
-- que o grupo tributario do produto mudar.

alter table public.fiscal_document_items
  add column if not exists icms_uf_destino_base numeric(14,2),
  add column if not exists icms_uf_destino_aliquota_interna numeric(7,4),
  add column if not exists icms_uf_destino_aliquota_interestadual numeric(7,4),
  add column if not exists icms_uf_destino_percentual_partilha numeric(7,4),
  add column if not exists icms_uf_destino_valor numeric(14,2),
  add column if not exists icms_uf_remetente_valor numeric(14,2),
  add column if not exists fcp_uf_destino_base numeric(14,2),
  add column if not exists fcp_uf_destino_aliquota numeric(7,4),
  add column if not exists fcp_uf_destino_valor numeric(14,2);

comment on column public.fiscal_document_items.icms_uf_destino_base is
  'vBCUFDest: base de calculo do ICMS devido a UF de destino (DIFAL da EC 87/2015). E BASE UNICA — a clausula segunda, §1º, do Convenio ICMS 236/2021 diz que a base "e unica e corresponde ao valor da operacao", entao e o MESMO numero de icms_base (ja reduzido quando ha pRedBC, pelo Convenio ICMS 153/2015) ou o valor_bruto quando o CST/CSOSN nao declara base propria. Preenchida por B4, 04/09/2026. Nula em toda nota que nao e venda interestadual a consumidor final nao contribuinte.';
comment on column public.fiscal_document_items.icms_uf_destino_aliquota_interna is
  'pICMSUFDest: aliquota INTERNA do estado de destino, em percentual. APROXIMADA por tax_groups.aliquota_icms — nao existe neste sistema tabela de aliquota interna por UF x NCM, e a mesma aproximacao ja e usada na base do ICMS-ST desde B2. A ressalva pesa mais aqui, porque o DIFAL e a diferenca entre duas aliquotas: ver a entrada de B4 no AGENTS.md. Gravada junto do valor porque o grupo tributario do produto muda e a nota precisa continuar dizendo com que numero calculou.';
comment on column public.fiscal_document_items.icms_uf_destino_aliquota_interestadual is
  'pICMSInter: aliquota interestadual da operacao (4%, 7% ou 12%), calculada por aliquotaInterestadual() nas Resolucoes do Senado 22/1989 e 13/2012. E o mesmo numero de icms_aliquota nas vendas de Regime Normal — sai duplicado porque o fisco confere cada grupo do XML por si.';
comment on column public.fiscal_document_items.icms_uf_destino_percentual_partilha is
  'pICMSInterPart: percentual do DIFAL que cabe a UF de destino. SEMPRE 100. O art. 99 do ADCT escalonou a partilha entre origem e destino (40% em 2016, 60% em 2017, 80% em 2018) e a encerrou em 100% para o destino a partir de 2019; o que acabou foi o escalonamento, nao o campo, que continua obrigatorio no grupo ICMSUFDest.';
comment on column public.fiscal_document_items.icms_uf_destino_valor is
  'vICMSUFDest: o DIFAL devido a UF de destino. E icms_uf_destino_base x (icms_uf_destino_aliquota_interna - icms_uf_destino_aliquota_interestadual) x icms_uf_destino_percentual_partilha, a formula literal da regra de validacao NA15-10 (rejeicao 815). NAO entra em total_nota: a regra W16-10 nao lista o DIFAL entre as parcelas de vNF, porque ele ja esta embutido no preco da mercadoria (base unica).';
comment on column public.fiscal_document_items.icms_uf_remetente_valor is
  'vICMSUFRemet: a parte do DIFAL que caberia a UF de ORIGEM. SEMPRE 0,00 desde 2019, e presente de proposito — a partilha acabou, o campo nao, e a NA01-20 o lista entre os exigidos do grupo. Zero aqui significa zero, e nao "nao calculado" como nas demais colunas desta tabela: quando a coluna e nula, o item nao tinha DIFAL nenhum.';
comment on column public.fiscal_document_items.fcp_uf_destino_base is
  'vBCFCPUFDest: base do FCP devido a UF de destino — a mesma icms_uf_destino_base. Campo proprio no leiaute (a legislacao estadual pode dar base distinta ao FCP), mesma decisao que B2 tomou para fcp_base. Nula quando o NCM x UF nao tem FCP cadastrado em mva_rules.';
comment on column public.fiscal_document_items.fcp_uf_destino_aliquota is
  'pFCPUFDest: percentual do Fundo de Combate a Pobreza do estado de destino, na operacao PROPRIA. Copiada de mva_rules.fcp_aliquota — a MESMA coluna de que sai o pFCPST, porque e o mesmo fato: o FCP e percentual do destino por NCM e nao muda conforme o imposto seja retido por ST ou devido por diferencial de aliquota; o que muda e a tag do XML. Nao confundir com fcp_aliquota, que e o FCP RETIDO POR ST (B2): sao impostos diferentes, em grupos diferentes, e um item pode ter os dois.';
comment on column public.fiscal_document_items.fcp_uf_destino_valor is
  'vFCPUFDest: valor do FCP devido a UF de destino na operacao propria = fcp_uf_destino_base x fcp_uf_destino_aliquota / 100. Nao entra na formula de conferencia do vICMSUFDest (a NA15-10 ignora o FCP) nem em total_nota. Era o que restava da tarefa B3 (FCP), encerrada por B4 em 04/09/2026.';

-- ---------------------------------------------------------------------
-- 2. fiscal_documents — os totais do grupo ICMSUFDest
-- ---------------------------------------------------------------------
--
-- As tres somas do grupo `total` (`ICMSTot`) que correspondem as colunas de
-- item acima. `total_fcp` NAO e reaproveitada para o FCP da operacao propria,
-- e e decisao: ela guarda o FCP retido por ST (`vFCPST`) desde B2, e os dois
-- sao impostos distintos em tags distintas do XML. Somar os dois numa coluna
-- so apagaria a distincao que uma fiscalizacao pediria — e a nota pode
-- legitimamente ter os dois.
--
-- NENHUMA das tres entra em `total_nota`: a regra W16-10 define vNF como
-- vProd - vDesc - vICMSDeson + vST + vFCPST + vFrete + vSeg + vOutro + vII +
-- vIPI + ..., e o DIFAL nao e parcela dela. Ao contrario do IPI e do ICMS-ST,
-- ele nao e acrescido ao documento: ja esta no preco da mercadoria, que e o
-- que a base unica do Convenio ICMS 236/2021 significa.

alter table public.fiscal_documents
  add column if not exists total_icms_uf_destino numeric(14,2),
  add column if not exists total_icms_uf_remetente numeric(14,2),
  add column if not exists total_fcp_uf_destino numeric(14,2);

comment on column public.fiscal_documents.total_icms_uf_destino is
  'vICMSUFDest do grupo total: soma do DIFAL da EC 87/2015 dos itens (B4, 04/09/2026). NAO entra em total_nota — o DIFAL nao e parcela do vNF pela regra W16-10, porque ja esta embutido no preco da mercadoria. Nula quando a nota nao e venda interestadual a consumidor final nao contribuinte.';
comment on column public.fiscal_documents.total_icms_uf_remetente is
  'vICMSUFRemet do grupo total: soma da parte do DIFAL que caberia a UF de origem. SEMPRE 0,00 quando existe — a partilha do art. 99 do ADCT terminou em 2019 com 100% para o destino —, e nula quando a nota nao tem DIFAL nenhum.';
comment on column public.fiscal_documents.total_fcp_uf_destino is
  'vFCPUFDest do grupo total: soma do FCP da OPERACAO PROPRIA devido a UF de destino (B4). Coluna separada de total_fcp de proposito: aquela guarda o FCP RETIDO POR ST (vFCPST, desde B2), e sao impostos diferentes em tags diferentes — uma nota pode ter os dois. Nao entra em total_nota.';

-- ---------------------------------------------------------------------
-- 3. Nada mais
-- ---------------------------------------------------------------------
--
-- Sem tabela nova, sem modulo novo, sem permissao nova, sem semente. B4 nao
-- acrescenta nenhuma pergunta ao cadastro: as tres grandezas de que precisa ja
-- estavam cadastradas — a aliquota interna (aproximada) em tax_groups, a
-- interestadual e fixa por lei e mora no codigo desde B2, e o FCP esta em
-- mva_rules desde B2 tambem. O que faltava era onde GRAVAR o resultado.
