-- A3 — modelo canônico do documento fiscal (01/09/2026)
--
-- Até aqui `fiscal_documents` guardava o **resultado** da emissão (chave,
-- protocolo, status, XML) e nada do **conteúdo** dela: emitente, destinatário,
-- itens e impostos só existiam dentro do `NfePayload` montado em memória por
-- `src/features/sales/invoiceMapping.ts`, e o único lugar onde sobreviviam era
-- dentro da string do XML. Duas consequências práticas disso:
--
--   1. Não dá para responder "quanto de ICMS essa nota destacou no item 2?"
--      sem parsear XML — e o XML do provedor simulado é gerado no navegador,
--      então nem é fonte confiável.
--   2. Reemitir, corrigir ou reconstruir uma nota depende de remontar o
--      payload a partir da venda — e a venda pode ter mudado (o cadastro do
--      produto muda, o do cliente muda, a regra de CFOP muda). Uma nota
--      autorizada não pode mudar retroativamente.
--
-- Esta migration inverte isso: o **modelo é a fonte da verdade e o XML vira
-- saída dele**. Três movimentos:
--
--   - `fiscal_documents` ganha o cabeçalho da nota (ide + emitente + destinatário
--     + totais), tudo desnormalizado como snapshot do momento da emissão;
--   - `fiscal_document_items` (nova) guarda uma linha por item, com o snapshot
--     do produto e as colunas por imposto que a Etapa 2 (motor tributário) vai
--     preencher;
--   - `fiscal_document_events` (nova) guarda autorização, rejeição,
--     cancelamento, carta de correção e inutilização, com o payload enviado e o
--     retorno da SEFAZ.
--
-- ## Snapshot, e não FK
--
-- Emitente e destinatário entram como colunas de texto, não como FK para
-- `branches`/`contacts`. Mesmo raciocínio já registrado no AGENTS.md para o
-- endereço de venda (13/08/2026): a nota descreve o que foi declarado à SEFAZ
-- **naquele momento**. Se o cliente mudar de endereço amanhã, a nota de ontem
-- continua tendo o endereço de ontem — uma FK faria a nota mentir
-- retroativamente. `fiscal_document_items.product_id` continua sendo FK, mas
-- só como rastro (`on delete set null`): quem descreve o item é o snapshot ao
-- lado, não a linha de `products`.
--
-- ## O que esta migration deliberadamente NÃO faz
--
--   - **Não remove as colunas `cancel_*` de `fiscal_documents`.** Elas passam a
--     ser redundantes com `fiscal_document_events` (tipo `cancelamento`), e
--     estão marcadas como obsoletas por `comment on column` — mas o código de
--     produção que roda hoje (`src/lib/repositories/fiscalDocumentsRepository.ts`,
--     `persistCancelResult`) ainda escreve nelas. Removê-las agora quebraria o
--     cancelamento entre esta tarefa e a A1, que é quem migra os escritores para
--     a Edge Function. O `drop` é a última etapa da A1, não desta.
--   - **Não remove as policies de `insert`/`update` de `fiscal_documents`.**
--     Mesmo motivo: hoje quem grava a nota é o cliente sob RLS. Quando a Edge
--     Function `fiscal-emit` (A1) assumir a escrita, essas duas policies saem
--     e `fiscal_documents` fica igual às duas tabelas novas — só leitura para o
--     cliente. As **tabelas novas já nascem assim**: nenhuma policy de
--     insert/update/delete para o cliente, e `revoke` explícito por cima, para
--     a permissão não depender só da policy.
--   - **Não semeia nada.** Nenhuma linha existente ganha snapshot retroativo:
--     as notas já emitidas foram geradas antes deste modelo existir e não há de
--     onde tirar o dado sem inventá-lo. Por isso todas as colunas novas de
--     `fiscal_documents` são nuláveis.

-- ---------------------------------------------------------------------
-- 1. Enums novos
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'fiscal_ambiente') then
    create type public.fiscal_ambiente as enum ('homologacao', 'producao');
  end if;
end $$;

comment on type public.fiscal_ambiente is
  'Ambiente de emissão (tpAmb da SEFAZ: 1 = produção, 2 = homologação). Guardado por documento, e não só na configuração do provedor, porque a mesma instalação pode ter notas dos dois ambientes ao longo do tempo — e uma nota de homologação nunca tem valor fiscal, independente de como o sistema esteja configurado hoje.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'fiscal_event_type') then
    create type public.fiscal_event_type as enum (
      'autorizacao',
      'rejeicao',
      'cancelamento',
      'carta_correcao',
      'inutilizacao'
    );
  end if;
end $$;

comment on type public.fiscal_event_type is
  'O que aconteceu com o documento (ou com a faixa de numeração, no caso da inutilização). Espelha os métodos do contrato FiscalProvider — ver supabase/functions/_shared/fiscal/provider.ts.';

-- ---------------------------------------------------------------------
-- 2. fiscal_documents — o cabeçalho da nota deixa de viver só no payload
-- ---------------------------------------------------------------------

alter table public.fiscal_documents
  -- ide (identificação da operação)
  add column if not exists ambiente public.fiscal_ambiente not null default 'homologacao',
  add column if not exists data_emissao timestamptz,
  add column if not exists natureza_operacao text,
  add column if not exists tipo_documento smallint,
  add column if not exists finalidade smallint,
  add column if not exists consumidor_final boolean,
  add column if not exists indicador_presenca smallint,
  add column if not exists local_destino smallint,
  add column if not exists modalidade_frete smallint,
  add column if not exists chave_referenciada text,

  -- emit (snapshot da filial no momento da emissão)
  add column if not exists emitente_cnpj text,
  add column if not exists emitente_nome text,
  add column if not exists emitente_nome_fantasia text,
  add column if not exists emitente_inscricao_estadual text,
  add column if not exists emitente_regime_tributario text,
  add column if not exists emitente_logradouro text,
  add column if not exists emitente_numero text,
  add column if not exists emitente_bairro text,
  add column if not exists emitente_municipio text,
  add column if not exists emitente_uf text,
  add column if not exists emitente_cep text,

  -- dest (snapshot do cliente; tudo nulo é caso legítimo — NFC-e de balcão)
  add column if not exists destinatario_nome text,
  add column if not exists destinatario_cnpj text,
  add column if not exists destinatario_cpf text,
  add column if not exists destinatario_inscricao_estadual text,
  add column if not exists destinatario_indicador_ie text,
  add column if not exists destinatario_logradouro text,
  add column if not exists destinatario_numero text,
  add column if not exists destinatario_bairro text,
  add column if not exists destinatario_municipio text,
  add column if not exists destinatario_uf text,
  add column if not exists destinatario_cep text,
  add column if not exists destinatario_pais text,
  add column if not exists destinatario_telefone text,

  -- total (grupo ICMSTot). Nulo ≠ zero: nulo é "não calculado", zero é
  -- "calculado e deu zero" — a diferença importa numa nota isenta.
  add column if not exists total_produtos numeric(14,2),
  add column if not exists total_desconto numeric(14,2),
  add column if not exists total_frete numeric(14,2),
  add column if not exists total_seguro numeric(14,2),
  add column if not exists total_outras_despesas numeric(14,2),
  add column if not exists total_nota numeric(14,2),
  add column if not exists total_icms_base numeric(14,2),
  add column if not exists total_icms numeric(14,2),
  add column if not exists total_icms_st_base numeric(14,2),
  add column if not exists total_icms_st numeric(14,2),
  add column if not exists total_fcp numeric(14,2),
  add column if not exists total_ipi numeric(14,2),
  add column if not exists total_pis numeric(14,2),
  add column if not exists total_cofins numeric(14,2),
  add column if not exists total_ibs numeric(14,2),
  add column if not exists total_cbs numeric(14,2),

  add column if not exists informacoes_adicionais text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fiscal_documents_tipo_documento_check') then
    alter table public.fiscal_documents
      add constraint fiscal_documents_tipo_documento_check
      check (tipo_documento is null or tipo_documento in (0, 1));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fiscal_documents_finalidade_check') then
    alter table public.fiscal_documents
      add constraint fiscal_documents_finalidade_check
      check (finalidade is null or finalidade in (1, 2, 3, 4));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fiscal_documents_indicador_presenca_check') then
    alter table public.fiscal_documents
      add constraint fiscal_documents_indicador_presenca_check
      check (indicador_presenca is null or indicador_presenca in (0, 1, 2, 3, 4, 5, 9));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fiscal_documents_local_destino_check') then
    alter table public.fiscal_documents
      add constraint fiscal_documents_local_destino_check
      check (local_destino is null or local_destino in (1, 2, 3));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fiscal_documents_modalidade_frete_check') then
    alter table public.fiscal_documents
      add constraint fiscal_documents_modalidade_frete_check
      check (modalidade_frete is null or modalidade_frete in (0, 1, 2, 3, 4, 9));
  end if;
end $$;

comment on column public.fiscal_documents.ambiente is
  'tpAmb da SEFAZ. Default homologacao: falha fechado, o mesmo critério do provedor simulado — uma linha sem ambiente declarado nunca deve ser lida como nota de produção.';
comment on column public.fiscal_documents.tipo_documento is
  'tpNF: 0 = entrada (nota de devolução), 1 = saída (venda).';
comment on column public.fiscal_documents.finalidade is
  'finNFe: 1 = normal, 2 = complementar, 3 = ajuste, 4 = devolução.';
comment on column public.fiscal_documents.indicador_presenca is
  'indPres: 0 = não se aplica, 1 = presencial, 2 = internet, 3 = teleatendimento, 4 = entrega a domicílio, 5 = presencial fora do estabelecimento, 9 = não presencial.';
comment on column public.fiscal_documents.local_destino is
  'idDest: 1 = operação interna, 2 = interestadual, 3 = exterior.';
comment on column public.fiscal_documents.modalidade_frete is
  'modFrete: 0 = por conta do emitente ... 9 = sem frete.';
comment on column public.fiscal_documents.chave_referenciada is
  'Chave de acesso da nota referenciada (grupo NFref/refNFe) — hoje só a nota de devolução preenche, apontando a NF-e da venda original. Coluna única, e não lista, porque é o único caso que o sistema produz: o payload da Focus aceita N referências, e se um segundo caso aparecer o lugar dele é uma tabela própria, não um array aqui.';
comment on column public.fiscal_documents.emitente_cnpj is
  'Snapshot da filial no momento da emissão — não é FK para branches de propósito: a nota não pode mudar retroativamente se o cadastro da filial mudar depois. Mesmo raciocínio do endereço de venda (AGENTS.md, 13/08/2026).';
comment on column public.fiscal_documents.destinatario_nome is
  'Snapshot do cliente. Todo o grupo de destinatário nulo é caso legítimo, não falta de dado: NFC-e de balcão sem CPF é a operação mais comum do PDV.';
comment on column public.fiscal_documents.total_nota is
  'vNF. Nulo significa "não calculado" (nota anterior a esta migration), não zero.';

-- As quatro colunas de cancelamento que `fiscal_document_events` substitui.
-- Continuam existindo até a A1 migrar os escritores — ver o cabeçalho.
comment on column public.fiscal_documents.cancel_xml_content is
  'OBSOLETA desde A3 (01/09/2026): o XML do cancelamento passa a ser uma linha em fiscal_document_events (tipo cancelamento). Mantida enquanto fiscalDocumentsRepository.ts ainda escrever aqui; o drop é a última etapa da A1.';
comment on column public.fiscal_documents.cancel_xml_path is
  'OBSOLETA desde A3 (01/09/2026) — ver fiscal_documents.cancel_xml_content.';
comment on column public.fiscal_documents.cancel_justificativa is
  'OBSOLETA desde A3 (01/09/2026) — ver fiscal_documents.cancel_xml_content. A justificativa passa a ser fiscal_document_events.justificativa.';

-- ---------------------------------------------------------------------
-- 3. fiscal_document_items — uma linha por item
-- ---------------------------------------------------------------------
--
-- Hoje o único dado fiscal por item que o sistema guarda é `sale_items.cfop`,
-- gravado **depois** da autorização (`updateSaleItemsCfop`). Isso está errado
-- em dois eixos: o CFOP é da nota, não da venda (a mesma venda devolvida sai
-- com CFOP de entrada), e escrever na venda depois da nota faz o dado da venda
-- depender de um evento fiscal. A coluna continua onde está por enquanto — quem
-- para de escrever nela é a A1 —, mas o lugar canônico do CFOP do item passa a
-- ser aqui.
--
-- Sem `branch_id` próprio: herda a filial via `fiscal_document_id`, mesmo
-- padrão de `sale_items`/`sale_payments`.

create table if not exists public.fiscal_document_items (
  id uuid primary key default gen_random_uuid(),
  fiscal_document_id uuid not null references public.fiscal_documents(id) on delete cascade,
  numero_item integer not null,

  -- Snapshot do produto. `product_id` é rastro, não descrição: `on delete set
  -- null` para o cadastro poder sumir sem levar a nota junto nem travar o
  -- delete (`sale_items` faz o contrário — NO ACTION —, e é por isso que um
  -- produto já vendido não é apagável; ver AGENTS.md, C4).
  product_id uuid references public.products(id) on delete set null,
  codigo_produto text not null,
  descricao text not null,
  ncm text,
  cest text,
  cfop text,
  origem_mercadoria text,
  unidade_comercial text,
  unidade_tributavel text,

  quantidade_comercial numeric(15,4) not null,
  valor_unitario_comercial numeric(15,4) not null,
  quantidade_tributavel numeric(15,4),
  valor_unitario_tributavel numeric(15,4),
  valor_bruto numeric(14,2) not null,
  valor_desconto numeric(14,2) not null default 0,
  valor_frete numeric(14,2) not null default 0,
  valor_seguro numeric(14,2) not null default 0,
  valor_outras_despesas numeric(14,2) not null default 0,
  inclui_no_total boolean not null default true,

  -- ICMS
  icms_situacao_tributaria text,
  icms_modalidade_base_calculo text,
  icms_base numeric(14,2),
  icms_reducao_base numeric(7,4),
  icms_aliquota numeric(7,4),
  icms_valor numeric(14,2),

  -- ICMS-ST (substituição tributária)
  icms_st_modalidade_base_calculo text,
  icms_st_mva numeric(7,4),
  icms_st_base numeric(14,2),
  icms_st_reducao_base numeric(7,4),
  icms_st_aliquota numeric(7,4),
  icms_st_valor numeric(14,2),

  -- FCP (Fundo de Combate à Pobreza)
  fcp_base numeric(14,2),
  fcp_aliquota numeric(7,4),
  fcp_valor numeric(14,2),

  -- PIS
  pis_situacao_tributaria text,
  pis_base numeric(14,2),
  pis_aliquota numeric(7,4),
  pis_valor numeric(14,2),

  -- COFINS
  cofins_situacao_tributaria text,
  cofins_base numeric(14,2),
  cofins_aliquota numeric(7,4),
  cofins_valor numeric(14,2),

  -- IPI
  ipi_situacao_tributaria text,
  ipi_codigo_enquadramento text,
  ipi_base numeric(14,2),
  ipi_aliquota numeric(7,4),
  ipi_valor numeric(14,2),

  -- IBS/CBS (Reforma Tributária, NT 2025.002-RTC)
  ibs_cbs_situacao_tributaria text,
  cclasstrib text,
  ibs_base numeric(14,2),
  ibs_aliquota numeric(7,4),
  ibs_valor numeric(14,2),
  cbs_base numeric(14,2),
  cbs_aliquota numeric(7,4),
  cbs_valor numeric(14,2),

  created_at timestamptz not null default now(),

  constraint fiscal_document_items_numero_item_check check (numero_item > 0),
  constraint fiscal_document_items_quantidade_check check (quantidade_comercial > 0),
  constraint fiscal_document_items_valor_unitario_check check (valor_unitario_comercial >= 0),
  constraint fiscal_document_items_valor_bruto_check check (valor_bruto >= 0)
);

comment on table public.fiscal_document_items is
  'Uma linha por item do documento fiscal, com snapshot do produto e as colunas por imposto. As colunas de base/redução/alíquota/valor nascem nulas: quem as preenche é o motor tributário da Etapa 2, que ainda não existe. Nulo aqui significa "não calculado", nunca zero.';
comment on column public.fiscal_document_items.numero_item is
  'nItem — a ordem do item dentro da nota, 1..N. Único por documento.';
comment on column public.fiscal_document_items.cfop is
  'CFOP do item. Lugar canônico do dado que hoje é gravado em sale_items.cfop depois da autorização — ver o cabeçalho desta seção.';
comment on column public.fiscal_document_items.icms_reducao_base is
  'pRedBC, em percentual. Redução de base só existe no schema da SEFAZ para ICMS e ICMS-ST (pRedBCST); PIS/COFINS/IPI/IBS/CBS não têm campo equivalente, e inventar colunas para eles criaria dado sem destino no XML.';
comment on column public.fiscal_document_items.ibs_cbs_situacao_tributaria is
  'CST de IBS/CBS (products.cst_ibs_cbs / tax_groups.cst_ibs_cbs). Um código só para os dois tributos, como a NT 2025.002-RTC define.';

create unique index if not exists fiscal_document_items_documento_numero_unique
  on public.fiscal_document_items (fiscal_document_id, numero_item);

create index if not exists fiscal_document_items_fiscal_document_id_idx
  on public.fiscal_document_items (fiscal_document_id);

-- FK sem índice de cobertura vira aviso no advisor de performance (foi o caso
-- de sale_returns.created_by na etapa 9) — este já nasce coberto.
create index if not exists fiscal_document_items_product_id_idx
  on public.fiscal_document_items (product_id);

-- ---------------------------------------------------------------------
-- 4. fiscal_document_events — o histórico fiscal
-- ---------------------------------------------------------------------
--
-- ## Por que esta tabela tem `branch_id` e `fiscal_document_items` não
--
-- Quatro dos cinco tipos de evento pertencem a um documento e poderiam herdar
-- a filial por ele. A **inutilização não**: ela declara à SEFAZ que uma faixa
-- de números de uma série nunca foi usada, e por definição não existe documento
-- nenhum para ela apontar (é o caso do número que ficou pelo caminho porque a
-- emissão falhou). Sem `branch_id` próprio, uma linha de inutilização ficaria
-- sem nenhuma âncora de filial — e RLS sem âncora é RLS que não filtra.
--
-- Como `fiscal_document_id` é opcional, `branch_id` poderia divergir do
-- documento apontado. Quem garante que não diverge é o trigger
-- `fiscal_document_events_branch_matches` abaixo, e não a boa vontade de quem
-- escreve: a mesma disciplina de `create_sale`, que valida antes de confiar.

create table if not exists public.fiscal_document_events (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  fiscal_document_id uuid references public.fiscal_documents(id) on delete cascade,
  tipo public.fiscal_event_type not null,
  -- Repetido aqui (e não só em fiscal_documents) pelo mesmo motivo de branch_id:
  -- a inutilização não tem documento de onde herdar, e uma faixa inutilizada em
  -- homologação não inutiliza nada em produção.
  ambiente public.fiscal_ambiente not null default 'homologacao',

  -- Identificador do pedido gerado por nós, quando o evento tem pedido próprio
  -- (hoje a inutilização; a carta de correção pode passar a ter). É o que torna
  -- o pedido idempotente, mesmo papel de `fiscal_documents.ref`.
  ref text,
  -- nSeqEvento: a CC-e é numerada de 1 a 20 por NF-e. Nulo nos eventos que não
  -- têm sequência (autorização, rejeição, inutilização).
  sequencia integer,

  status_sefaz text,
  mensagem_sefaz text,
  protocolo text,
  -- Cancelamento e inutilização usam `justificativa` (15 a 255 caracteres pela
  -- regra da SEFAZ); a carta de correção usa `correcao` (15 a 1000). Colunas
  -- separadas porque são campos diferentes no XML, com limites diferentes.
  justificativa text,
  correcao text,

  -- Faixa inutilizada. Só a inutilização preenche — ver o CHECK abaixo.
  model public.fiscal_document_model,
  serie text,
  numero_inicial integer,
  numero_final integer,

  -- O que foi mandado e o que voltou, crus. É o que permite auditar uma
  -- rejeição sem depender da mensagem que a tela mostrou na hora.
  request_payload jsonb,
  response_payload jsonb,
  xml_content text,
  xml_path text,

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- O default só funciona para escrita autenticada. Quando a Edge Function
  -- assumir (A1), ela roda com `service_role` e `auth.uid()` volta nulo — quem
  -- pediu o evento tem de vir explícito no insert, não do default. Mesma
  -- pegadinha que `fiscal_documents.created_by` vai ter.
  created_by uuid default auth.uid() references public.profiles(id),

  constraint fiscal_document_events_origem_check check (
    (
      tipo = 'inutilizacao'
      and fiscal_document_id is null
      -- `ref` é o que torna o pedido idempotente (o contrato do provedor exige);
      -- sem ela, um retry duplicaria a inutilização no banco.
      and ref is not null
      and model is not null
      and serie is not null
      and numero_inicial is not null
      and numero_final is not null
      and numero_inicial > 0
      and numero_final >= numero_inicial
    )
    or (
      tipo <> 'inutilizacao'
      and fiscal_document_id is not null
    )
  ),
  constraint fiscal_document_events_sequencia_check check (
    sequencia is null or sequencia > 0
  )
);

comment on table public.fiscal_document_events is
  'Histórico fiscal: autorização, rejeição, cancelamento, carta de correção e inutilização de faixa, com o payload enviado e o retorno da SEFAZ. Substitui as colunas cancel_* soltas de fiscal_documents (que continuam existindo até a A1 migrar os escritores). Espelha os métodos do contrato FiscalProvider — ver supabase/functions/_shared/fiscal/provider.ts.';
comment on column public.fiscal_document_events.fiscal_document_id is
  'Nulo apenas na inutilização, que não é evento de um documento — ver o CHECK fiscal_document_events_origem_check e o comentário no cabeçalho da seção.';
comment on column public.fiscal_document_events.branch_id is
  'A filial do evento. Existe (em vez de herdar por fiscal_document_id, como fiscal_document_items faz) porque a inutilização não tem documento de onde herdar. O trigger fiscal_document_events_branch_matches garante que, quando há documento, os dois concordam.';
comment on column public.fiscal_document_events.request_payload is
  'O corpo enviado ao provedor, cru. Guardado para auditoria: sem ele, uma rejeição da SEFAZ só pode ser investigada remontando o payload a partir de dados que podem ter mudado desde então.';

create unique index if not exists fiscal_document_events_ref_unique
  on public.fiscal_document_events (ref)
  where ref is not null;

-- Duas cartas de correção com o mesmo nSeqEvento no mesmo documento seriam
-- recusadas pela SEFAZ; o banco não deveria conseguir representá-las.
create unique index if not exists fiscal_document_events_sequencia_unique
  on public.fiscal_document_events (fiscal_document_id, tipo, sequencia)
  where fiscal_document_id is not null and sequencia is not null;

create index if not exists fiscal_document_events_fiscal_document_id_idx
  on public.fiscal_document_events (fiscal_document_id);

create index if not exists fiscal_document_events_branch_id_idx
  on public.fiscal_document_events (branch_id);

create index if not exists fiscal_document_events_created_by_idx
  on public.fiscal_document_events (created_by);

create or replace function public.fiscal_document_events_branch_matches()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_branch uuid;
begin
  if new.fiscal_document_id is null then
    return new;
  end if;

  select branch_id into v_branch
  from public.fiscal_documents
  where id = new.fiscal_document_id;

  if v_branch is null then
    raise exception 'Documento fiscal % não encontrado.', new.fiscal_document_id
      using errcode = '23503';
  end if;

  if new.branch_id is distinct from v_branch then
    raise exception 'A filial do evento (%) não confere com a do documento fiscal (%).',
      new.branch_id, v_branch
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

comment on function public.fiscal_document_events_branch_matches() is
  'Impede que um evento aponte um documento de outra filial — a RLS de fiscal_document_events filtra por branch_id, então um branch_id divergente seria um vazamento entre filiais, não só um dado inconsistente.';

-- A Supabase concede EXECUTE a anon/authenticated/service_role por padrão ao
-- criar a função, e `revoke ... from public` sozinho não basta (convenção do
-- supabase/migrations/README.md). Função de trigger não precisa de EXECUTE em
-- tempo de execução — o privilégio é checado ao criar o trigger.
revoke all on function public.fiscal_document_events_branch_matches() from public, anon, authenticated;

create or replace trigger fiscal_document_events_branch_matches
  before insert or update on public.fiscal_document_events
  for each row execute function public.fiscal_document_events_branch_matches();

-- ---------------------------------------------------------------------
-- 5. RLS — leitura pelo mesmo portão de Notas Emitidas, escrita por ninguém
-- ---------------------------------------------------------------------
--
-- Policies separadas por comando, nunca `for all` (convenção do README). Aqui
-- isso significa **uma policy só em cada tabela**: `select`. Não existe policy
-- de insert/update/delete de propósito — quem escreve nestas duas tabelas é a
-- Edge Function `fiscal-emit` (tarefa A1), que roda com `service_role` e por
-- isso não passa por RLS. Um cliente autenticado não deve conseguir forjar
-- item nem evento de nota fiscal nem com a permissão máxima do RBAC.

alter table public.fiscal_document_items enable row level security;
alter table public.fiscal_document_events enable row level security;

drop policy if exists "read fiscal_document_items" on public.fiscal_document_items;
create policy "read fiscal_document_items" on public.fiscal_document_items
  for select using (
    exists (
      select 1
      from public.fiscal_documents fd
      where fd.id = fiscal_document_items.fiscal_document_id
        and public.has_permission('notas-emitidas', 'view')
        and public.has_branch_access(fd.branch_id)
    )
  );

drop policy if exists "read fiscal_document_events" on public.fiscal_document_events;
create policy "read fiscal_document_events" on public.fiscal_document_events
  for select using (
    public.has_permission('notas-emitidas', 'view')
    and public.has_branch_access(branch_id)
  );

-- Defesa em profundidade sobre a ausência de policy: `alter default privileges`
-- da Supabase concede ALL a anon/authenticated em toda tabela nova do schema
-- public. Sem policy de escrita a RLS já barra, mas deixar o GRANT de
-- INSERT/UPDATE/DELETE de pé faria a proteção depender de uma única camada.
revoke all on table public.fiscal_document_items from anon, authenticated;
revoke all on table public.fiscal_document_events from anon, authenticated;

grant select on table public.fiscal_document_items to anon, authenticated;
grant select on table public.fiscal_document_events to anon, authenticated;

grant all on table public.fiscal_document_items to service_role;
grant all on table public.fiscal_document_events to service_role;
