# Migrations

Antes de 29/08/2026 o banco do Facilite ERP não tinha nenhum SQL versionado:
tabelas, ~52 funções `security definer`, policies de RLS, triggers e views
existiam só no projeto Supabase, e a única descrição deles era prosa no
`AGENTS.md`. Ninguém conseguia revisar uma RPC sem abrir o painel da Supabase,
e nenhum teste conseguia afirmar o que uma policy faz.

A partir daqui, **toda mudança de banco vira arquivo `.sql` commitado aqui**.

## Baseline

`00000000000000_baseline.sql` é a fotografia do schema que já estava em
produção em 29/08/2026. Ele **não é para ser executado no banco atual** — o
schema já existe. Serve para:

- tornar as RPCs revisáveis em code review e em diff;
- permitir recriar o banco do zero num ambiente descartável (demo, teste de
  restauração — tarefa C7, e a base das baterias de `tests/isolation/`);
- dar um ponto de partida para `supabase db diff`.

Como o baseline foi gerado está descrito em `supabase/migrations/GERAR-BASELINE.md`.

## Convenções (herdadas do roteiro do AGENTS.md)

- Policies `select`/`insert`/`update`/`delete` **separadas** — nunca `for all`,
  que duplica a cobertura do `select` e dispara "multiple permissive policies"
  no advisor.
- `using (has_permission('modulo-id', 'view') and has_branch_access(branch_id))`
  — o `has_branch_access` só entra se a tabela tiver `branch_id`.
- Toda função nova precisa de `revoke execute ... from public, anon` explícito:
  a Supabase concede `EXECUTE` a `anon`/`authenticated`/`service_role` por
  padrão ao criar a função, e `revoke ... from public` sozinho não basta.
- Depois de aplicar: rodar os advisors (security **e** performance) e corrigir
  os avisos novos na hora, não no fim.
