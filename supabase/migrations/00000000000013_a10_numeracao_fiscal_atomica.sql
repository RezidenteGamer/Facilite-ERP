-- A10 — a numeração fiscal deixa de ser um máximo lido sem trava (09/09/2026)
--
-- Sétima tarefa da Etapa 3, e a que **toda tarefa desde B4 vinha adiando com o
-- nome dela escrito**: A5 ("a reserva não faz nada por vendas diferentes, que é
-- o caso de A10"), A6, A7 ("reemitir consome numeração, e a numeração não é
-- atômica — é a razão nº 3 de `erro_autorizacao` ter ficado de fora da fila"),
-- A8 e A9 ("intocada").
--
-- ## A corrida que existe hoje
--
-- `handleEmit` lê `readLastNumero(admin, branchId, model)` — um `select` da
-- coluna `numero` inteira, **sem trava nenhuma** — e passa o máximo encontrado
-- como semente para uma instância nova do provedor simulado, criada por
-- requisição. Duas emissões concorrentes de **vendas diferentes** na mesma
-- filial e modelo leem o mesmo máximo, e cada uma calcula `máximo + 1` dentro
-- do próprio processo: as duas saem com o **mesmo número**.
--
-- É a mesma classe de corrida que A5 fechou para a `ref`, com uma diferença que
-- muda o primitivo: A5 precisava que **só um** vencedor prosseguisse; aqui todo
-- mundo prossegue, cada um com um número **diferente e sequencial**. O primitivo
-- para isso não é o `insert` que esbarra em unicidade (A5) nem o CAS sobre o
-- status (A5, reemissão): é **uma linha por sequência e um incremento que o
-- próprio Postgres serializa** —
-- `insert ... on conflict do update set ultimo_numero = ultimo_numero + 1
--  returning ultimo_numero`. Duas transações que caem na mesma linha: a segunda
-- espera o lock da primeira e o `DO UPDATE` reavalia sobre a versão já
-- incrementada. Não é preciso `select ... for update` explícito, nem uma segunda
-- escrita, nem transação entre statements (que o PostgREST não oferece).
--
-- ## A chave: **CNPJ do emitente**, e não `branch_id`
--
-- A numeração de NF-e/NFC-e é sequencial **por estabelecimento, modelo e
-- série** — e "estabelecimento" é o CNPJ de 14 dígitos, que é o que entra na
-- chave de acesso (cUF + AAMM + **CNPJ** + mod + **serie** + **nNF** + tpEmis +
-- cNF + DV). Duas filiais que dividissem o mesmo CNPJ com contadores separados
-- por `branch_id` emitiriam o mesmo `nNF` no mesmo mês: chaves de acesso iguais
-- em tudo menos no `cNF` sorteado, e Rejeição 539 (duplicidade de NF-e com
-- diferença na chave de acesso) na segunda.
--
-- Duas coisas conferidas neste banco antes de decidir, não presumidas:
--
--   1. **Matriz e filial NÃO dividem CNPJ.** Os quatro dígitos de ordem do
--      estabelecimento (`/0001`, `/0002`, ...) fazem parte do CNPJ, então o
--      cenário que o enunciado levantou não é o de matriz/filial — é o de duas
--      linhas de `branches` para o **mesmo** estabelecimento (duplicata de
--      cadastro, ou dois pontos de venda registrados como filiais separadas com
--      o CNPJ da matriz). Esse é o cenário contra o qual a chave protege.
--   2. **Hoje há uma filial só** (`00.000.000/0001-91`), sem CNPJ duplicado
--      entre filiais e sem filial com CNPJ inválido. Ou seja: a escolha da chave
--      **não muda nada nos dados de hoje** — ela muda o que acontece no dia em
--      que uma segunda filial for cadastrada, que é justamente quando ninguém
--      vai estar olhando para este arquivo.
--
-- `branch_id` **não é coluna desta tabela**, e a ausência é a decisão: guardá-lo
-- ao lado da chave criaria um segundo eixo que pode divergir do primeiro (duas
-- filiais, um CNPJ) e faria o leitor achar que a numeração é por filial.
--
-- ## Por que `ambiente` entra na chave
--
-- Homologação e produção são bases distintas da SEFAZ, e este projeto já trata a
-- distinção como estrutural em dois lugares: `fiscal_documents.ambiente` ("uma
-- nota de homologação nunca tem valor fiscal", A3) e
-- `fiscal_document_events.ambiente` ("uma faixa inutilizada em homologação não
-- inutiliza nada em produção", A3). Numeração é da mesma família: uma nota de
-- teste não pode queimar um número de produção. Sem `ambiente` na chave, o dia
-- em que `FISCAL_AMBIENTE=producao` for ligado a primeira nota real nasceria
-- continuando a contagem das notas simuladas.
--
-- ## O que esta migration deliberadamente NÃO faz
--
--   - **Não cria tabela de faixa inutilizada.** Ela já existe:
--     `fiscal_document_events` com `tipo = 'inutilizacao'` (A3), que tem
--     `branch_id`, `ambiente`, `model`, `serie`, `numero_inicial`,
--     `numero_final` e um CHECK exigindo os cinco. O que A10 acrescenta é a
--     **consulta**: `fiscal_numbering_next` pula a faixa quando ela existir.
--     Criar uma segunda tabela para o mesmo fato seria a "segunda fonte da
--     verdade" que a migration de A7 recusou para `fiscal_queue`.
--   - **Não liga `invalidateRange` a tela nenhuma.** `fiscal-emit` despacha
--     `emit`/`cancel`/`query`/`sweep` e mais nada; a inutilização continua sem
--     porta HTTP, e `fiscal_document_events` está **vazia** (conferido: zero
--     linhas de qualquer tipo). O pulo de faixa nasce, portanto, exercitando
--     zero linhas — é preparo, não funcionalidade.
--   - **Não toca no mecanismo de reserva de A5/A6/A7.** São dois problemas de
--     concorrência diferentes — *identidade* da emissão (`ref`) e *sequência* do
--     número — e continuam com mecanismos separados de propósito.
--   - **Não muda regra de cálculo tributário.**

-- ---------------------------------------------------------------------
-- 1. fiscal_numbering — uma linha por sequência
-- ---------------------------------------------------------------------
--
-- Chave primária composta, sem `id` surrogate: a linha **é** a chave, e um uuid
-- ao lado só criaria um segundo jeito de endereçá-la. Precedente no projeto:
-- `user_branches (user_id, branch_id)`.
--
-- `ultimo_numero` é o último número **entregue**, não o próximo a entregar. Uma
-- linha recém-criada com `ultimo_numero = 1` significa "o número 1 já saiu".

create table if not exists public.fiscal_numbering (
  -- Só dígitos, sempre — o `regexp_replace` de `fiscal_numbering_next` é quem
  -- normaliza, e o CHECK garante que ninguém escreva "00.000.000/0001-91" aqui
  -- por outro caminho e crie uma segunda sequência para o mesmo emitente.
  emitente_cnpj text not null,
  model public.fiscal_document_model not null,
  serie integer not null,
  ambiente public.fiscal_ambiente not null,

  ultimo_numero integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fiscal_numbering_pkey primary key (emitente_cnpj, model, serie, ambiente),
  constraint fiscal_numbering_cnpj_check check (emitente_cnpj ~ '^[0-9]{14}$'),
  -- Série da NF-e: 0 a 999 (campo `serie` do layout).
  constraint fiscal_numbering_serie_check check (serie between 0 and 999),
  -- nNF vai de 1 a 999.999.999. Zero é válido aqui só como estado inicial
  -- ("nenhum número entregue ainda").
  constraint fiscal_numbering_ultimo_numero_check check (ultimo_numero between 0 and 999999999)
);

comment on table public.fiscal_numbering is
  'Numeração fiscal sequencial (A10, 09/09/2026): uma linha por CNPJ do emitente + modelo + série + ambiente, com o último número entregue. Substitui readLastNumero (um max() lido sem trava, que duas emissões concorrentes liam igual) e o Map em memória do provedor simulado (que zerava a cada isolate). Quem entrega número é public.fiscal_numbering_next() — nunca um select seguido de update. A chave é o CNPJ, e não branch_id, porque a numeração da SEFAZ é por estabelecimento: duas filiais com o mesmo CNPJ e contadores separados produziriam a mesma chave de acesso.';
comment on column public.fiscal_numbering.emitente_cnpj is
  'CNPJ do emitente, só dígitos (14). É o "estabelecimento" da regra da SEFAZ e o que entra na chave de acesso. Não há branch_id nesta tabela de propósito — ver o comentário da tabela.';
comment on column public.fiscal_numbering.ultimo_numero is
  'Último número JÁ ENTREGUE (não o próximo). 0 = nenhum ainda. Só fiscal_numbering_next() escreve aqui, e sempre por incremento atômico na própria linha.';
comment on column public.fiscal_numbering.ambiente is
  'Homologação e produção são sequências separadas — uma nota de teste não queima número de produção. Mesmo raciocínio de fiscal_document_events.ambiente para faixa inutilizada (A3).';

-- ---------------------------------------------------------------------
-- 2. Semente a partir do que já existe em fiscal_documents
-- ---------------------------------------------------------------------
--
-- **A tabela não pode nascer do zero.** `fiscal_documents` já tem notas com
-- número, e um contador começando em 0 entregaria o número 1 para uma emissão
-- nova enquanto o 1 já existe no banco (e, com provedor real, na SEFAZ).
--
-- Três cuidados, cada um por um motivo conferido nos dados:
--
--   1. **O CNPJ vem de `branches`, não do documento.** As 15 notas de hoje têm
--      `fiscal_documents.emitente_cnpj` **nulo** — elas são da era do navegador
--      (agosto/2026), anteriores a A3 ter criado a coluna. O `coalesce` com
--      `b.cnpj` não é defesa teórica: é o único caminho para 100% das linhas
--      existentes. O `emitente_cnpj` do documento vem primeiro mesmo assim,
--      porque para uma nota emitida depois de A3 ele é o snapshot do que foi
--      **declarado**, e é ele que está na chave de acesso.
--   2. **`numero` e `serie` são `text`** (o provedor real devolve string), então
--      os dois passam por um filtro de dígitos antes do cast. Conferido: zero
--      linha com número não numérico e zero com série não numérica hoje.
--   3. **`max()` numérico, nunca lexicográfico.** É a mesma pegadinha que
--      `readLastNumero` documentava: em `text`, "9" > "10".
--
-- Entram todas as notas **com número**, inclusive canceladas: um número
-- cancelado foi usado e não volta. Ficam de fora as sem número (reserva, recusa
-- antes de numerar) — elas não consumiram nada.
--
-- `on conflict ... greatest(...)` faz duas coisas: torna a migration idempotente
-- e garante que reaplicá-la **nunca ande para trás** com um contador que já
-- avançou depois da primeira aplicação.
--
-- Resultado esperado neste banco (conferido rodando o `select` desta mesma
-- subconsulta em leitura, antes de escrever a migration): duas linhas —
-- `00000000000191 / nfe / 1 / homologacao / 2` e
-- `00000000000191 / nfce / 1 / homologacao / 3` —, cobrindo as 15 notas
-- (8 + 7), nenhuma descartada.

insert into public.fiscal_numbering (emitente_cnpj, model, serie, ambiente, ultimo_numero)
select
  base.emitente_cnpj,
  base.model,
  base.serie::integer,
  base.ambiente,
  max(base.numero)::integer as ultimo_numero
from (
  select
    regexp_replace(coalesce(fd.emitente_cnpj, b.cnpj, ''), '[^0-9]', '', 'g') as emitente_cnpj,
    fd.model,
    -- **`numeric`, e não `integer`.** O cast roda aqui dentro e os limites de
    -- faixa são conferidos na consulta de fora, então um `numero` de 20 dígitos
    -- (que o regex aceita) estouraria o `integer` e **abortaria a migration**
    -- antes de o `between` ter chance de descartar a linha. `numeric` não
    -- estoura; o `::integer` vem depois, já com a faixa garantida.
    case when coalesce(fd.serie, '') ~ '^[0-9]+$' then fd.serie::numeric else 1 end as serie,
    fd.ambiente,
    fd.numero::numeric as numero
  from public.fiscal_documents fd
  join public.branches b on b.id = fd.branch_id
  where fd.numero ~ '^[0-9]+$'
) base
where base.emitente_cnpj ~ '^[0-9]{14}$'
  and base.serie between 0 and 999
  and base.numero between 1 and 999999999
group by base.emitente_cnpj, base.model, base.serie, base.ambiente
on conflict (emitente_cnpj, model, serie, ambiente)
do update set
  ultimo_numero = greatest(public.fiscal_numbering.ultimo_numero, excluded.ultimo_numero),
  updated_at = now();

-- ---------------------------------------------------------------------
-- 3. fiscal_numbering_next — o incremento atômico, e o pulo da faixa inutilizada
-- ---------------------------------------------------------------------
--
-- **Por que uma função, e não um `update` direto pelo PostgREST:** o PostgREST
-- só aceita valores literais no corpo de um `update` — não há como escrever
-- `ultimo_numero = ultimo_numero + 1` por ele. Fazer `select` e depois `update`
-- pela borda seria exatamente a corrida que esta tarefa fecha. Então o
-- incremento tem de acontecer **dentro de um statement do Postgres**, e a Edge
-- Function o chama por RPC.
--
-- ## A faixa inutilizada
--
-- Número inutilizado não volta a ser usado — é justamente o que a inutilização
-- declara à SEFAZ. A fonte das faixas é `fiscal_document_events`
-- (`tipo = 'inutilizacao'`), a tabela que A3 já desenhou para isso; a junção com
-- `branches` existe porque aquela tabela ancora em `branch_id` (ela precisa de
-- âncora de filial para a RLS) e esta sequência é por CNPJ — se duas filiais
-- dividirem o CNPJ, as faixas das duas valem para a mesma sequência, que é o
-- comportamento certo.
--
-- O laço pula a faixa **inteira** de uma vez (custo proporcional ao número de
-- faixas, não ao tamanho delas) e itera porque faixas podem encadear (1–10 e
-- 11–20). Ele progride sempre: cada volta leva `v_numero` para além do fim da
-- faixa que o cobria, e `order by numero_final desc` garante que, se houver
-- faixas sobrepostas, o salto é para além da que vai mais longe.
--
-- **Reescrever a linha dentro do laço é seguro** e não é uma segunda corrida: o
-- `insert ... on conflict` acima já deixou esta linha travada por **esta**
-- transação, e ninguém mais a altera até o commit.
--
-- **Contrato de quem escreve a faixa:** só existe linha de `inutilizacao` para
-- faixa que a SEFAZ homologou — mesma disciplina que `handleCancel` já segue
-- (recusa não grava nada). Por isso não há filtro por `status_sefaz` aqui:
-- inventar um seria supor que a tabela guarda pedido recusado, e ela não guarda.

create or replace function public.fiscal_numbering_next(
  p_cnpj text,
  p_model public.fiscal_document_model,
  p_serie integer,
  p_ambiente public.fiscal_ambiente
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  v_numero integer;
  v_final integer;
  v_voltas integer := 0;
begin
  -- Falha fechado nas duas entradas que poderiam criar uma sequência paralela
  -- silenciosa (um CNPJ mascarado viraria outra linha; uma série nula viraria
  -- erro feio no CHECK). A borda já valida o CNPJ antes disto
  -- (`validarPayloadFiscal`, A9, roda antes de qualquer provedor) — aqui é a
  -- segunda camada.
  if v_cnpj !~ '^[0-9]{14}$' then
    raise exception
      'fiscal_numbering_next: CNPJ do emitente inválido (esperado 14 dígitos, recebido %)',
      coalesce(p_cnpj, '<nulo>');
  end if;
  if p_serie is null or p_serie < 0 or p_serie > 999 then
    raise exception
      'fiscal_numbering_next: série inválida (esperado inteiro de 0 a 999, recebido %)',
      coalesce(p_serie::text, '<nula>');
  end if;
  if p_model is null or p_ambiente is null then
    raise exception 'fiscal_numbering_next: modelo e ambiente são obrigatórios';
  end if;

  begin
    -- O incremento atômico. Quem chega junto espera o lock da linha e o
    -- `DO UPDATE` reavalia sobre a versão já incrementada — dois chamadores
    -- concorrentes saem com N e N+1, nunca com N e N.
    insert into public.fiscal_numbering (emitente_cnpj, model, serie, ambiente, ultimo_numero)
    values (v_cnpj, p_model, p_serie, p_ambiente, 1)
    on conflict (emitente_cnpj, model, serie, ambiente)
    do update set
      ultimo_numero = fiscal_numbering.ultimo_numero + 1,
      updated_at = now()
    returning fiscal_numbering.ultimo_numero into v_numero;

    loop
      select e.numero_final
        into v_final
        from public.fiscal_document_events e
        join public.branches b on b.id = e.branch_id
       where e.tipo = 'inutilizacao'
         and e.ambiente = p_ambiente
         and e.model = p_model
         -- `numeric` pelo mesmo motivo da semente: uma `serie` com mais
         -- dígitos que o `integer` aguenta estouraria aqui, e esta consulta roda
         -- **em toda emissão** — uma linha torta em `fiscal_document_events`
         -- derrubaria a numeração inteira.
         and (case when coalesce(e.serie, '') ~ '^[0-9]+$' then e.serie::numeric end) = p_serie
         and regexp_replace(coalesce(b.cnpj, ''), '[^0-9]', '', 'g') = v_cnpj
         and v_numero between e.numero_inicial and e.numero_final
       order by e.numero_final desc
       limit 1;

      -- `select ... into` sem linha atribui NULL ao alvo: é assim que o laço sai.
      exit when v_final is null;

      v_voltas := v_voltas + 1;
      if v_voltas > 1000 then
        raise exception
          'fiscal_numbering_next: mais de 1000 faixas inutilizadas encadeadas para % / % / série % (%). Confira fiscal_document_events.',
          v_cnpj, p_model, p_serie, p_ambiente;
      end if;

      update public.fiscal_numbering
         set ultimo_numero = v_final + 1,
             updated_at = now()
       where emitente_cnpj = v_cnpj
         and model = p_model
         and serie = p_serie
         and ambiente = p_ambiente
      returning fiscal_numbering.ultimo_numero into v_numero;
    end loop;
  exception
    when check_violation then
      -- O único CHECK alcançável aqui é o teto de `ultimo_numero`: o do CNPJ e o
      -- da série já foram validados acima.
      raise exception
        'fiscal_numbering_next: a numeração do CNPJ % (modelo %, série %, ambiente %) chegou ao limite de 999.999.999. Emita numa série nova.',
        v_cnpj, p_model, p_serie, p_ambiente;
  end;

  return v_numero;
end;
$function$;

comment on function public.fiscal_numbering_next(text, public.fiscal_document_model, integer, public.fiscal_ambiente) is
  'Entrega o próximo número fiscal da sequência CNPJ + modelo + série + ambiente, de forma atômica (A10, 09/09/2026): insert ... on conflict do update set ultimo_numero = ultimo_numero + 1 returning, que o Postgres serializa sozinho na linha. Pula faixas já inutilizadas (fiscal_document_events, tipo = inutilizacao). Um número entregue NÃO volta para a sequência se a emissão falhar depois — o buraco é resolvido por inutilização de faixa, que é o mecanismo fiscal para isso; devolvê-lo recriaria a corrida.';

-- ---------------------------------------------------------------------
-- 3b. O índice que faz o pulo de faixa ser barato
-- ---------------------------------------------------------------------
--
-- A consulta de faixa inutilizada roda **em toda emissão**, e
-- `fiscal_document_events` ganha uma linha por autorização, rejeição e
-- cancelamento — ou seja, ela só cresce, e a esmagadora maioria das linhas não
-- é inutilização. Sem índice isso é um seq scan da tabela inteira a cada nota
-- emitida, para descobrir que não há faixa nenhuma a pular.
--
-- **Parcial**, pelo mesmo motivo de `fiscal_documents_reserva_presa_idx` (A7):
-- inutilização é exceção. Hoje o índice tem **zero linha** (a tabela está
-- vazia), cabe em quase nada, e não pesa nas escritas de evento que não são
-- inutilização.

-- **`serie` fica de fora das colunas de propósito.** Ela é `text` naquela
-- tabela e a consulta a compara como número (`e.serie::numeric = p_serie`), o
-- que nenhum índice sobre a coluna de texto atenderia. `model` e `ambiente` são
-- comparados diretamente e entram; o filtro por série acontece sobre as poucas
-- linhas que sobrarem.

create index if not exists fiscal_document_events_inutilizacao_faixa_idx
  on public.fiscal_document_events (model, ambiente, numero_inicial, numero_final)
  where tipo = 'inutilizacao';

comment on index public.fiscal_document_events_inutilizacao_faixa_idx is
  'Sustenta o pulo de faixa inutilizada de fiscal_numbering_next (A10), que roda em toda emissão. Parcial porque inutilização é exceção entre os eventos fiscais: no caminho comum o índice tem zero linha, enquanto a tabela cresce uma linha por autorização.';

-- ---------------------------------------------------------------------
-- 4. RLS e grants — a tabela não é dado de tela
-- ---------------------------------------------------------------------
--
-- **RLS ligada e nenhuma policy**, ao contrário de `fiscal_queue` (que tem
-- `select` para quem enxerga a nota). A diferença é o que a linha significa: a
-- fila é informação de suporte sobre uma nota específica ("está sendo perseguida
-- há 3 tentativas"); esta tabela é o **contador** — ninguém a consulta para
-- entender uma nota, e o número dela já aparece em `fiscal_documents.numero`,
-- com filial e RLS. Uma policy de leitura aqui exporia a numeração de todas as
-- filiais de um CNPJ a quem tem acesso a uma delas, sem nenhuma tela precisando
-- disso.
--
-- Quem lê e escreve é `fiscal_numbering_next`, que é `security definer` — nem a
-- própria Edge Function precisa de `grant` na tabela.

alter table public.fiscal_numbering enable row level security;

-- Defesa em profundidade sobre a ausência de policy: o `alter default
-- privileges` da Supabase concede ALL a anon/authenticated em toda tabela nova
-- de `public`. Sem policy a RLS já barra, mas a proteção não deve depender de
-- uma camada só (A3, A1, A7).
revoke all on table public.fiscal_numbering from anon, authenticated;

-- A Supabase concede EXECUTE a anon/authenticated/service_role por padrão ao
-- criar a função, e `revoke ... from public` sozinho não basta (convenção do
-- supabase/migrations/README.md). Esta é `security definer` e **avança um
-- contador fiscal a cada chamada** — chamá-la sem emitir nota queima um número.
-- Só a Edge Function, que roda com `service_role`, pode.
revoke all on function public.fiscal_numbering_next(text, public.fiscal_document_model, integer, public.fiscal_ambiente)
  from public, anon, authenticated;
grant execute on function public.fiscal_numbering_next(text, public.fiscal_document_model, integer, public.fiscal_ambiente)
  to service_role;

-- ---------------------------------------------------------------------
-- 5. Ordem de aplicação e como conferir à mão
-- ---------------------------------------------------------------------
--
-- A ordem é: **aplicar esta migration → implantar `fiscal-emit`**. Fora dela,
-- toda emissão falha no RPC ausente (`fiscal_numbering_next` não existe) e a
-- reserva é desfeita por `releaseEmission` — a venda continua emitível e nenhuma
-- nota é perdida, mas ninguém emite até a migration entrar.
--
-- 1. A semente cobriu o que já existia:
--
--      select * from public.fiscal_numbering order by emitente_cnpj, model, serie;
--
--    Esperado hoje: `00000000000191 / nfe / 1 / homologacao / 2` e
--    `.../ nfce / 1 / homologacao / 3`.
--
-- 2. Nenhuma nota existente ficou acima do contador (a consulta tem de voltar
--    **vazia** — se voltar linha, a próxima emissão daquela chave colide):
--
--      select n.emitente_cnpj, n.model, n.serie, n.ambiente, n.ultimo_numero,
--             max(d.numero::numeric) as maior_nota
--        from public.fiscal_numbering n
--        join public.fiscal_documents d
--          on d.model = n.model
--         and d.ambiente = n.ambiente
--         and d.numero ~ '^[0-9]+$'
--         and (case when coalesce(d.serie, '') ~ '^[0-9]+$' then d.serie::numeric else 1 end) = n.serie
--        join public.branches b on b.id = d.branch_id
--       where regexp_replace(coalesce(d.emitente_cnpj, b.cnpj, ''), '[^0-9]', '', 'g') = n.emitente_cnpj
--       group by 1, 2, 3, 4, 5
--      having max(d.numero::numeric) > n.ultimo_numero;
--
--    O `join` **precisa** casar o CNPJ (a primeira coluna da chave) do mesmo
--    jeito que a semente o resolve, e a série precisa ser comparada como
--    número: sem isso, com dois CNPJs no banco a consulta compara o contador de
--    um com as notas do outro, e uma série gravada como '01' nunca casaria com
--    a série 1.
--
-- 3. O incremento é atômico (duas sessões psql, sem commit entre elas): a
--    segunda `select public.fiscal_numbering_next(...)` **bloqueia** até a
--    primeira commitar, e devolve o número seguinte. Atenção: **cada chamada
--    queima um número** — validar à mão consome numeração de verdade.
--
-- 4. A prova automatizada é `tests/concurrency/fiscalNumberingConcurrency.test.ts`,
--    que dispara emissões simultâneas de vendas diferentes contra a função
--    implantada e exige números distintos e sequenciais.
