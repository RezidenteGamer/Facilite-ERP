#!/usr/bin/env bash
set -euo pipefail

# Gera o dump lógico diário (C7): roles + schema + dados do schema public,
# mais o manifesto de contagem de linhas (scripts/backup/manifest.sql), tudo
# empacotado num único .tar.gz em backup-output/. Não criptografa — isso é
# scripts/backup/encrypt-package.sh, rodado depois pelo workflow.
#
# Escopo deliberadamente restrito a --schema public: exclui auth, storage,
# extensions, realtime, vault etc. (a infraestrutura que a própria Supabase
# gerencia). Ver AGENTS.md, seção C7, para o raciocínio completo — em
# resumo, isso mantém o pacote restaurável num Postgres genérico (sem as
# extensões proprietárias da Supabase) e evita guardar dados de auth.users
# num artefato, mesmo criptografado, num repositório público.
#
# `supabase db dump` roda pg_dump dentro de um container Docker — por isso
# só funciona em ambiente com Docker (GitHub Actions runners já têm).
# Nunca rode este script apontando para o projeto Supabase de verdade fora
# do workflow agendado — ver a regra em AGENTS.md.

: "${SUPABASE_DB_URL:?defina SUPABASE_DB_URL (connection string do Session Pooler do Supabase — ver AGENTS.md sobre por que não é a conexão direta)}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="backup-output"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "==> Dump de roles"
npx --yes supabase db dump --db-url "$SUPABASE_DB_URL" -f "$OUT_DIR/roles.sql" --role-only

echo "==> Dump de schema (public)"
npx --yes supabase db dump --db-url "$SUPABASE_DB_URL" -f "$OUT_DIR/schema.sql" --schema public

echo "==> Dump de dados (public)"
npx --yes supabase db dump --db-url "$SUPABASE_DB_URL" -f "$OUT_DIR/data.sql" --schema public --use-copy --data-only

echo "==> Manifesto de contagem de linhas (origem)"
psql "$SUPABASE_DB_URL" -t -A -f "$SCRIPT_DIR/manifest.sql" > "$OUT_DIR/manifest.json"

echo "$STAMP" > "$OUT_DIR/dumped-at.txt"

PACKAGE="$OUT_DIR/db-backup-$STAMP.tar.gz"
tar -C "$OUT_DIR" -czf "$PACKAGE" roles.sql schema.sql data.sql manifest.json dumped-at.txt
rm "$OUT_DIR"/roles.sql "$OUT_DIR"/schema.sql "$OUT_DIR"/data.sql "$OUT_DIR"/manifest.json "$OUT_DIR"/dumped-at.txt

echo "Pacote gerado: $PACKAGE"
