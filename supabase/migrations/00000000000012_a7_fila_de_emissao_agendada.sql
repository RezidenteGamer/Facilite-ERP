-- A7 — a fila de reprocessamento agendado da emissão fiscal (09/09/2026)
--
-- A6 (09/09/2026) deu saída à **reserva órfã**: uma linha de `fiscal_documents`
-- que ficou em `processando_autorizacao` porque o isolate da Edge Function
-- morreu no meio da emissão (limite de CPU, de memória, ou uma implantação em
-- voo). A saída é o botão "Consultar status" de Notas Emitidas, que pergunta ao
-- provedor pela `ref` e só então decide — nunca libera pelo relógio.
--
-- O que A6 deixou aberto, com todas as letras: *"o limiar só serve para decidir
-- quando consultar sem um humano presente, e isso é agendamento — A7."* Sem
-- agendamento, uma venda cuja emissão morreu numa sexta às 18h fica presa até
-- alguém abrir a tela e clicar — e o operador **não tem como saber que precisa
-- clicar**, porque a tela diz "emissão em andamento".
--
-- Esta migration é esse agendamento, e **só** ele.
--
-- ## O que entra na fila, e o que ficou de fora (a decisão desta tarefa)
--
--   - **ENTRA: reserva presa** (`processando_autorizacao` mais velha que o
--     limite de relógio da plataforma, 400 s). É reaproveitamento puro de A6:
--     a varredura chama a mesma `decideConsulta`, pelo mesmo caminho.
--   - **NÃO ENTRA: `erro_autorizacao`.** Reemitir é emitir documento fiscal, e
--     uma recusa da SEFAZ é determinística — um NCM inválido recusa igual para
--     sempre, consumindo crédito do provedor a cada tentativa. O subconjunto que
--     *seria* seguro reemitir (as rejeições transitórias, como serviço
--     paralisado) não é distinguível neste código hoje: o único `status_sefaz`
--     de emissão que existe é o `225` do provedor simulado, e `focusProvider`
--     lança `FiscalNotConfiguredError` nas sete operações até A12. Some-se que
--     toda reemissão consome numeração, e a numeração ainda não é atômica (A10).
--   - **NÃO ENTRA: a venda cuja emissão nunca aconteceu** (falha de transporte,
--     que `releaseEmission` apaga sem deixar rastro). Não há o que varrer:
--     `sales` não tem coluna nenhuma que registre "o operador pediu nota" —
--     conferido no catálogo —, então a fila não distinguiria essa venda de
--     qualquer venda de balcão que nunca deveria ter nota.
--
-- O raciocínio completo está em `supabase/functions/fiscal-emit/queue.ts` e na
-- entrada de A7 no AGENTS.md. **O clique continua síncrono**: nem "Emitir Nota"
-- nem o checkbox da finalização da venda mudaram.
--
-- ## Ordem de aplicação
--
-- Esta migration **cria o agendamento**, e o agendamento chama a Edge Function.
-- A ordem é:
--
--   1. criar os três segredos no Vault (seção 5 — a migration NÃO os cria, e
--      não contém segredo nenhum);
--   2. definir `FISCAL_QUEUE_SECRET` nos secrets da Edge Function, com o mesmo
--      valor do segredo `fiscal_queue_sweep_secret` do Vault;
--   3. implantar `fiscal-emit` com a ação `sweep`;
--   4. aplicar esta migration.
--
-- Fora de ordem nada quebra de forma perigosa — o tique falha e o erro fica em
-- `cron.job_run_details`, e a função responde 503 enquanto `FISCAL_QUEUE_SECRET`
-- não existir (falha fechado, de propósito).

-- ---------------------------------------------------------------------
-- 1. As duas extensões
-- ---------------------------------------------------------------------
--
-- Nenhuma das duas estava instalada neste projeto — conferido em
-- `pg_available_extensions` (pg_cron 1.6.4 e pg_net 0.20.4 disponíveis,
-- `installed_version` nulo nas duas).
--
-- **O schema.** `pg_cron` vai em `pg_catalog`, que é a forma documentada pela
-- Supabase; a extensão cria por conta própria o schema `cron`, onde ficam
-- `cron.job` e `cron.job_run_details`. `pg_net` é criada sem cláusula de schema
-- (também a forma documentada) e cria o schema `net`. Nenhuma das duas vai para
-- `public`. Todo objeto delas é referenciado aqui **qualificado**
-- (`cron.schedule`, `net.http_post`), para que nada dependa de `search_path`.

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- 2. fiscal_queue — o livro de tentativas, e não uma segunda lista de trabalho
-- ---------------------------------------------------------------------
--
-- **Esta tabela não guarda "o que precisa ser processado".** Isso já está em
-- `fiscal_documents`: uma reserva presa é uma linha em
-- `processando_autorizacao`, e duplicá-la aqui criaria duas fontes da verdade
-- sobre a mesma nota, que divergem no primeiro erro de escrita.
--
-- O que ela guarda é o que `fiscal_documents` não tem como guardar: **quantas
-- vezes a fila já tentou e quando pode tentar de novo**. Sem isso, um provedor
-- fora do ar seria consultado a cada 5 minutos, para sempre, por cada linha
-- presa.
--
-- A linha nasce na primeira tentativa que **não** resolveu o documento e é
-- apagada quando ele sai de `processando_autorizacao` — a fila contém só o que
-- ainda está sendo perseguido. O histórico do que aconteceu não fica aqui: fica
-- em `fiscal_document_events`, com `request_payload.origem = 'fila'`, que é a
-- tabela que uma auditoria fiscal vai ler.
--
-- Sem `branch_id` próprio: herda a filial via `fiscal_document_id`, mesmo padrão
-- (e mesmo motivo) de `fiscal_document_items` — ao contrário de
-- `fiscal_document_events`, aqui não existe o caso da inutilização, que é o que
-- obrigava aquela tabela a ter âncora própria.

create table if not exists public.fiscal_queue (
  id uuid primary key default gen_random_uuid(),

  -- `on delete cascade` acompanha `fiscal_document_items` e
  -- `fiscal_document_events`: a fila é sobre um documento, e sem ele não
  -- significa nada. Ao contrário daquelas duas, apagar aqui não perde histórico
  -- — o histórico está nos eventos.
  fiscal_document_id uuid not null references public.fiscal_documents(id) on delete cascade,

  -- Falhas **consecutivas** da própria fila (transporte, provedor fora do ar,
  -- erro ao escrever). Zera quando o provedor responde, mesmo que a resposta
  -- seja "ainda estou processando" — ele falou com a gente, e isso não é falha.
  tentativas integer not null default 0,
  ultima_tentativa_em timestamptz,
  proxima_tentativa_em timestamptz not null default now(),
  -- A mensagem da última falha, para o suporte não precisar caçar log.
  ultimo_erro text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fiscal_queue_tentativas_check check (tentativas >= 0)
);

comment on table public.fiscal_queue is
  'Livro de tentativas da varredura agendada de A7 (09/09/2026). NÃO é a lista do que precisa ser processado — essa é fiscal_documents em processando_autorizacao. Guarda só quantas vezes a fila já tentou resolver cada reserva presa e quando ela pode tentar de novo (backoff). A linha é apagada quando o documento sai de processando_autorizacao; o histórico do que aconteceu fica em fiscal_document_events, com request_payload.origem = ''fila''.';
comment on column public.fiscal_queue.tentativas is
  'Falhas CONSECUTIVAS da fila. Zera quando o provedor responde — inclusive quando responde "ainda estou processando", que é o caso normal da emissão assíncrona de A12 e não pode ser tratado como falha, sob pena de o backoff abandonar justamente a nota que a fila existe para acompanhar.';
comment on column public.fiscal_queue.proxima_tentativa_em is
  'Backoff: 5 min, 15 min, 45 min, 2h15 e daí em diante o teto de 6h. NÃO existe limite de tentativas de propósito — desistir significaria uma venda sem nota, presa em processando_autorizacao, que nenhuma tela deixa reemitir e que ninguém está vigiando. Uma requisição a cada 6 horas é barata e cura sozinha quando o provedor volta. Ver LIMIAR_RESERVA_ORFA_MS e BACKOFF_TETO_MS em supabase/functions/fiscal-emit/queue.ts.';

-- Um documento tem no máximo uma linha de fila. É também o índice que o `upsert`
-- de `saveQueueEntry` usa como `onConflict`.
create unique index if not exists fiscal_queue_fiscal_document_id_unique
  on public.fiscal_queue (fiscal_document_id);

-- A varredura lê por documento (o `in (...)` de `readQueueEntries`); o índice
-- único acima já cobre. Este cobre a leitura por vencimento, que é como um
-- humano vai olhar a fila no suporte.
create index if not exists fiscal_queue_proxima_tentativa_em_idx
  on public.fiscal_queue (proxima_tentativa_em);

-- ---------------------------------------------------------------------
-- 3. Índice que faz a varredura ser barata
-- ---------------------------------------------------------------------
--
-- `readStuckReservations` faz `where status = 'processando_autorizacao' and
-- updated_at < corte order by updated_at`. Sem índice isso é seq scan em
-- `fiscal_documents` a cada 5 minutos, para sempre — e `fiscal_documents` só
-- cresce.
--
-- **Parcial**, e não por status inteiro: as linhas reservadas são um punhado
-- entre todas as notas do banco (no caminho feliz, zero), então o índice cabe
-- em quase nada e não pesa nas escritas de emissão que não são reserva.

create index if not exists fiscal_documents_reserva_presa_idx
  on public.fiscal_documents (updated_at)
  where status = 'processando_autorizacao';

comment on index public.fiscal_documents_reserva_presa_idx is
  'Sustenta a varredura de A7 (readStuckReservations). Parcial porque reserva presa é exceção: no caminho feliz o índice tem zero linha.';

-- ---------------------------------------------------------------------
-- 4. RLS — leitura pelo mesmo portão de Notas Emitidas, escrita por ninguém
-- ---------------------------------------------------------------------
--
-- Mesma disciplina de A3: policy separada por comando (nunca `for all`), e aqui
-- isso significa **uma policy só** — `select`. Quem escreve é a Edge Function
-- com `service_role`, que não passa por RLS.
--
-- A leitura existe porque a fila é informação de suporte ("esta nota está sendo
-- perseguida há 3 tentativas, a próxima é às 14:05, o último erro foi X"), e
-- quem precisa dela é quem já enxerga a nota. O portão é o mesmo de
-- `fiscal_document_items`: pelo documento, sem `branch_id` próprio para divergir.

alter table public.fiscal_queue enable row level security;

drop policy if exists "read fiscal_queue" on public.fiscal_queue;
create policy "read fiscal_queue" on public.fiscal_queue
  for select using (
    exists (
      select 1
      from public.fiscal_documents fd
      where fd.id = fiscal_queue.fiscal_document_id
        and public.has_permission('notas-emitidas', 'view')
        and public.has_branch_access(fd.branch_id)
    )
  );

-- Defesa em profundidade sobre a ausência de policy de escrita: o
-- `alter default privileges` da Supabase concede ALL a anon/authenticated em
-- toda tabela nova de `public`. Sem policy a RLS já barra, mas a proteção não
-- deve depender de uma camada só (A3, A1).
revoke all on table public.fiscal_queue from anon, authenticated;
grant select on table public.fiscal_queue to anon, authenticated;
grant all on table public.fiscal_queue to service_role;

-- ---------------------------------------------------------------------
-- 5. O tique — e por que ele é uma função, não SQL solto dentro do cron
-- ---------------------------------------------------------------------
--
-- **Esta migration não contém segredo nenhum**, e não cria nenhum. Ela lê três
-- segredos do Vault em tempo de execução, que o operador cria uma vez, à mão,
-- **antes** de aplicar:
--
--   select vault.create_secret('https://ifmdedruuetbbqjbnrkd.supabase.co', 'fiscal_queue_project_url');
--   select vault.create_secret('<chave anônima do projeto>',              'fiscal_queue_anon_key');
--   select vault.create_secret('<segredo aleatório de 32+ bytes>',        'fiscal_queue_sweep_secret');
--
-- O terceiro tem de ser **o mesmo valor** de `FISCAL_QUEUE_SECRET` nos secrets
-- da Edge Function (`supabase secrets set FISCAL_QUEUE_SECRET=...`). Ele existe
-- porque a varredura não tem usuário: `emit`, `cancel` e `query` são atos de um
-- operador e passam por `has_permission`/`has_branch_access`, que decidem por
-- `auth.uid()`; criar um "usuário de serviço" com permissão fiscal em todas as
-- filiais recriaria exatamente a conta que A1 fechou. A chave anônima vai no
-- `Authorization` só para passar pelo gateway (`verify_jwt = true` em
-- `config.toml`) — ela é pública e não autoriza nada; quem autoriza é o segredo.
--
-- **Por que uma função e não o `net.http_post` direto no `cron.schedule`:**
--
--   1. Ela **falha macio e legível** quando os segredos ainda não existem — um
--      `raise warning` e nada mais, em vez de o job estourar todo tique.
--   2. A URL e os headers ficam num lugar só, e mudá-los não exige reagendar.
--   3. Dá para validar à mão com um `select public.fiscal_queue_tick();`, que é
--      o único jeito de testar isto sem esperar cinco minutos.

create or replace function public.fiscal_queue_tick()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_url text;
  v_anon_key text;
  v_segredo text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'fiscal_queue_project_url';
  select decrypted_secret into v_anon_key
    from vault.decrypted_secrets where name = 'fiscal_queue_anon_key';
  select decrypted_secret into v_segredo
    from vault.decrypted_secrets where name = 'fiscal_queue_sweep_secret';

  if v_url is null or v_anon_key is null or v_segredo is null then
    -- Aviso, e não exceção: um job que estoura a cada 5 minutos enche
    -- `cron.job_run_details` de ruído e não conserta nada. A ausência dos
    -- segredos é uma etapa de instalação que ainda não foi feita, não um erro
    -- do agendador.
    raise warning
      'fiscal_queue_tick: segredos ausentes no Vault (fiscal_queue_project_url / fiscal_queue_anon_key / fiscal_queue_sweep_secret). A varredura não rodou.';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/fiscal-emit',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Só para passar pelo gateway. Ver o comentário da seção.
      'Authorization', 'Bearer ' || v_anon_key,
      'x-fiscal-queue-secret', v_segredo
    ),
    body := jsonb_build_object('action', 'sweep'),
    -- A varredura faz até 25 consultas ao provedor por tique (LOTE_MAXIMO em
    -- `queue.ts`), sequenciais. `pg_net` é assíncrona — ela devolve um id e não
    -- segura o agendador —, mas o timeout dela **encerra a requisição**, e uma
    -- requisição encerrada pode levar o isolate junto (`EarlyDrop`) com a cauda
    -- do lote por processar.
    --
    -- 180 s dá ~7 s por linha, folgado para um round-trip real de consulta, e
    -- fica bem abaixo dos 400 s de relógio da própria Edge Function — que
    -- continua sendo o teto de verdade. Uma cauda perdida não corrompe nada (as
    -- escritas de cada linha são independentes e a linha é retentada no tique
    -- seguinte), mas ela aparece como timeout em `net._http_response` em vez do
    -- resumo, e isso esconderia o que a varredura de fato fez.
    timeout_milliseconds := 180000
  );
end;
$function$;

comment on function public.fiscal_queue_tick() is
  'Um tique da varredura fiscal de A7: chama a ação `sweep` de fiscal-emit, que resolve reservas presas em processando_autorizacao consultando o provedor (mesma lógica de A6 — decideConsulta). Não emite nem reemite nota nenhuma. Lê a URL, a chave anônima e o segredo da varredura do Vault; sem eles, avisa e não faz nada.';

-- A Supabase concede EXECUTE a anon/authenticated/service_role por padrão ao
-- criar a função, e `revoke ... from public` sozinho não basta (convenção do
-- supabase/migrations/README.md). Esta é `security definer` e dispara uma
-- chamada HTTP autenticada — ninguém além do agendador deve poder executá-la.
revoke all on function public.fiscal_queue_tick() from public, anon, authenticated, service_role;
grant execute on function public.fiscal_queue_tick() to postgres;

-- ---------------------------------------------------------------------
-- 6. O agendamento
-- ---------------------------------------------------------------------
--
-- **A cada 5 minutos**, e o número tem duas âncoras:
--
--   - **Por baixo:** uma reserva só é candidata depois de 400 s (~6,7 min) — o
--     limite de relógio de um worker de Edge Function, que é o que garante que
--     nenhum isolate vivo ainda está segurando aquela emissão. Tique de 1 minuto
--     rodaria 5 vezes mais para, no melhor caso, descobrir a mesma coisa 4
--     minutos antes; nos outros 4 tiques ele não acha nada, porque não há nada
--     novo para achar.
--   - **Por cima:** a latência de detecção no pior caso é 400 s + o intervalo.
--     Com 5 minutos isso dá ~12 minutos entre a emissão morrer e a venda voltar
--     a poder ser emitida. Com 1 hora, seria uma venda sem nota por uma hora,
--     com o operador vendo "emissão em andamento" e sem nada a fazer.
--
-- Cabe com folga nos limites dos dois lados: a Supabase recomenda no máximo 8
-- jobs concorrentes e jobs de até 10 minutos (este é 1 job de segundos), e a
-- Focus documenta 100 créditos por minuto por token — o lote de 25 consultas a
-- cada 5 minutos usa 25 deles, num minuto só, com a emissão normal acontecendo
-- ao lado.
--
-- `cron.schedule` é upsert por nome: reaplicar a migration reescreve o mesmo
-- job em vez de criar um segundo.

select cron.schedule(
  'fiscal-queue-tick',
  '*/5 * * * *',
  $$ select public.fiscal_queue_tick(); $$
);

-- ---------------------------------------------------------------------
-- 7. Como validar à mão (não há como testar agendamento em Vitest)
-- ---------------------------------------------------------------------
--
-- 1. O job existe e está ativo:
--
--      select jobid, jobname, schedule, active, command
--        from cron.job where jobname = 'fiscal-queue-tick';
--
-- 2. Forçar um tique agora, sem esperar cinco minutos:
--
--      select public.fiscal_queue_tick();
--
--    Sem os segredos do Vault, isso devolve o `warning` da seção 5 e nada mais.
--
-- 3. O que a requisição respondeu (pg_net guarda 6 horas):
--
--      select id, status_code, content, error_msg, created
--        from net._http_response order by created desc limit 5;
--
--    Esperado: 200 com `{"ok":true,"candidatos":N,"tentados":N,...}`. Um 503
--    significa `FISCAL_QUEUE_SECRET` ausente nos secrets da função; um 401,
--    segredo diferente do que está no Vault.
--
-- 4. O histórico dos tiques:
--
--      select jobid, status, return_message, start_time, end_time
--        from cron.job_run_details
--       where jobid = (select jobid from cron.job where jobname = 'fiscal-queue-tick')
--       order by start_time desc limit 10;
--
--    Atenção: `cron.job_run_details` **não é limpa sozinha** e não some quando o
--    job é removido. Se ela crescer demais, apagar por `start_time` é seguro.
--
-- 5. O estado da fila:
--
--      select fq.*, fd.ref, fd.status
--        from public.fiscal_queue fq
--        join public.fiscal_documents fd on fd.id = fq.fiscal_document_id
--       order by fq.proxima_tentativa_em;
--
--    No caminho feliz esta consulta volta **vazia**: a fila só guarda o que
--    ainda está sendo perseguido.
--
-- Para desligar a varredura sem desfazer nada:
--
--      select cron.unschedule('fiscal-queue-tick');
