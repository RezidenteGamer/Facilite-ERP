-- Roda ANTES de restaurar schema.sql num Postgres efêmero genérico
-- (postgres:17 puro, sem a imagem da Supabase). Cobre exatamente o que o
-- schema public deste projeto usa e que um Postgres comum não tem de
-- fábrica — nada além disso (checado via grep nas migrations, ver AGENTS.md
-- seção C7):
--
--   * `extensions.unaccent(...)` — usada nas funções de busca (produtos,
--     contatos, séries fiscais). Precisa do schema `extensions` e da
--     extensão `unaccent` já existirem antes do CREATE FUNCTION rodar.
--   * `auth.uid()` / `auth.role()` — usadas nas policies de RLS. Na
--     Supabase real são funções de verdade; aqui bastam stubs que devolvem
--     NULL, porque ninguém está autenticado durante o restore de teste.
--
-- pg_cron e pg_net (usados pela fila fiscal, A7) NÃO têm extensão
-- disponível num Postgres genérico — de propósito não são stubados aqui.
-- CREATE FUNCTION com corpo PL/pgSQL não valida chamadas a funções
-- inexistentes na criação (só na execução), e o gatilho que de fato chama
-- net.http_post fica desligado durante a carga dos dados via
-- `session_replication_role = replica` (restore-and-verify.sh) — então
-- schema.sql aplica normalmente e o dado nunca dispara a chamada de verdade
-- contra a fila fiscal.

create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select null::text $$;
