-- A1 — a escrita fiscal passa a ser exclusiva da Edge Function (01/09/2026)
--
-- Última etapa da tarefa A1. As duas migrations anteriores prepararam o
-- terreno; esta fecha a porta que sobrou.
--
-- Até aqui **o cliente gravava nota fiscal**: `src/lib/repositories/
-- fiscalDocumentsRepository.ts` fazia `insert`/`update` direto em
-- `fiscal_documents` sob RLS, e `updateSaleItemsCfop` fazia `update` em
-- `sale_items`. Agora quem grava é a Edge Function `fiscal-emit`
-- (`supabase/functions/fiscal-emit/`), com `service_role`, que não passa por
-- RLS — as policies de escrita deixaram de ter usuário legítimo e passaram a
-- ser só superfície de ataque.
--
-- Esta migration **não pode ser aplicada antes de a função estar implantada**:
-- entre o `drop policy` e o deploy, nenhuma nota é emitida (o cliente perde a
-- permissão de gravar antes de existir quem grave por ele). A ordem é:
--
--   1. aplicar 00000000000003 (modelo canônico de A3, se ainda não aplicada);
--   2. implantar a Edge Function `fiscal-emit`;
--   3. aplicar esta.
--
-- ## O que sai, e por quê
--
--   - **As 3 colunas `cancel_*` de `fiscal_documents`**, marcadas OBSOLETAS por
--     `comment on column` em A3. O cancelamento passou a ser uma linha de
--     `fiscal_document_events` (tipo `cancelamento`), com justificativa, XML,
--     retorno da SEFAZ e autor — tudo o que as três colunas guardavam, mais o
--     que elas não conseguiam guardar (mais de um evento por documento, e o
--     pedido que foi enviado). Nenhuma tela lia essas colunas: `InvoiceDocument`
--     expunha `xmlCancelamento` e nenhum componente o consumia.
--   - **As policies de `insert` e `update` de `fiscal_documents`.** Com elas de
--     pé, qualquer sessão autenticada com `notas-emitidas.create` podia inserir
--     uma linha de nota fiscal com chave, protocolo e status inventados — sem
--     nunca falar com a SEFAZ. `fiscal_documents` fica igual às duas tabelas
--     criadas em A3: `select` para quem tem permissão, escrita só por
--     `service_role`.
--   - **A policy `notas-emitidas update sale_items cfop`.** Ela existia
--     unicamente para `updateSaleItemsCfop` gravar o CFOP resolvido nos itens
--     da venda depois da autorização — função que deixou de existir em A1,
--     porque o lugar canônico do CFOP do item passou a ser
--     `fiscal_document_items.cfop` (A3). O detalhe que faz dela mais que código
--     morto: a policy é `for update` **sem restrição de coluna**, então quem
--     tivesse `notas-emitidas.create` podia reescrever `unit_price` e
--     `total_amount` de qualquer item de venda da filial. É um buraco da mesma
--     família do C3 (29/08/2026), e ele só pôde ser fechado agora porque só
--     agora ninguém precisa mais dessa porta.
--
-- ## O que NÃO sai
--
--   - **A coluna `sale_items.cfop`.** Ela guarda o CFOP das notas emitidas antes
--     desta tarefa, e apagá-la jogaria fora dado histórico que não tem cópia em
--     `fiscal_document_items` (as notas antigas não têm itens lá — A3 não semeia
--     nada retroativo). Fica marcada como não mais escrita.
--   - **A policy de `select`.** Continua como estava: `has_permission
--     ('notas-emitidas', 'view')` + `has_branch_access(branch_id)`.

-- ---------------------------------------------------------------------
-- 1. fiscal_documents — nem cliente insere, nem cliente atualiza
-- ---------------------------------------------------------------------

drop policy if exists "insert fiscal_documents" on public.fiscal_documents;
drop policy if exists "update fiscal_documents" on public.fiscal_documents;

-- Defesa em profundidade sobre a ausência de policy, mesmo padrão que A3 usou
-- nas tabelas novas: `alter default privileges` da Supabase concedeu ALL a
-- anon/authenticated, e sem policy a RLS já barra — mas a proteção não deve
-- depender de uma camada só.
revoke all on table public.fiscal_documents from anon, authenticated;
grant select on table public.fiscal_documents to anon, authenticated;
grant all on table public.fiscal_documents to service_role;

-- ---------------------------------------------------------------------
-- 2. As colunas de cancelamento que fiscal_document_events substituiu
-- ---------------------------------------------------------------------

alter table public.fiscal_documents
  drop column if exists cancel_xml_content,
  drop column if exists cancel_xml_path,
  drop column if exists cancel_justificativa;

-- ---------------------------------------------------------------------
-- 3. sale_items — a porta que existia só para gravar o CFOP
-- ---------------------------------------------------------------------

drop policy if exists "notas-emitidas update sale_items cfop" on public.sale_items;

-- Sem policy de insert/update/delete, `sale_items` fica sendo escrita apenas
-- pelas funções `security definer` de venda (`create_sale`, `create_pos_sale`,
-- `convert_sale_order_to_sale`, ...), que rodam como dono da função e não
-- dependem destes GRANTs.
revoke insert, update, delete on table public.sale_items from anon, authenticated;

comment on column public.sale_items.cfop is
  'Histórico: preenchido até A1 (01/09/2026) por updateSaleItemsCfop, depois da autorização da nota. Deixou de ser escrito — o CFOP do item é de fiscal_document_items.cfop (A3), porque ele é da nota e não da venda (a mesma venda devolvida sai com CFOP de entrada). A coluna continua existindo pelas notas emitidas antes desta mudança, que não têm cópia em fiscal_document_items.';
