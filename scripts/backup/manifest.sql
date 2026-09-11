-- Conta as linhas de cada tabela do schema public e devolve um único JSON
-- {"tabela": contagem, ...}. Usada nos dois lados da conferência de C7: uma
-- vez no dump diário (backup-diario.yml), registrando a contagem de origem
-- dentro do próprio pacote, e de novo no restore de teste mensal
-- (restore-mensal.yml), depois de restaurar o dump num Postgres efêmero —
-- as duas saídas são comparadas para provar que o backup restaura íntegro.
--
-- Truque do query_to_xml: como SQL puro não tem laço sobre nomes de tabela,
-- usamos query_to_xml para rodar "select count(*)" contra cada tabela e
-- extrair o número via xpath — evita precisar de um bloco PL/pgSQL só para
-- isso. format(%I) escapa os identificadores, então é seguro mesmo que um
-- nome de tabela tenha caracteres especiais.
select coalesce(json_object_agg(t.table_name, t.row_count), '{}'::json)
from (
  select
    c.relname as table_name,
    (xpath(
      '/row/cnt/text()',
      query_to_xml(format('select count(*) as cnt from %I.%I', 'public', c.relname), false, true, '')
    ))[1]::text::bigint as row_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
) t;
