#!/usr/bin/env bash
set -euo pipefail

# Descriptografa o backup diário mais recente, restaura num Postgres
# efêmero (o `services: postgres` do próprio job do restore-mensal.yml —
# nasce e morre dentro do job, nunca fica de pé cobrando nada) e confere que
# a contagem de linhas por tabela bate com o manifesto gerado no dump.
# Roda só dentro de restore-mensal.yml, nunca localmente contra produção.
#
# roles.sql e schema.sql rodam de forma TOLERANTE a erro (sem
# --single-transaction/ON_ERROR_STOP): testar este fluxo contra um
# postgres:17 genérico mostrou que ele já vem com um role `postgres` e um
# schema `public` pré-existentes, e o dump tenta recriá-los — um erro de
# "já existe" nesses dois pontos é esperado e inofensivo, não motivo para
# abortar o restore inteiro. Quem decide se o restore passou ou falhou de
# verdade é só o passo 4 (comparação do manifesto): se algum erro real
# impediu dados de entrar, a contagem não bate e o job falha.

: "${BACKUP_ENCRYPTION_PASSPHRASE:?defina BACKUP_ENCRYPTION_PASSPHRASE}"
: "${RESTORE_DB_URL:?defina RESTORE_DB_URL (o Postgres efêmero do job)}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IN_DIR="backup-input"
WORK_DIR="restore-work"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

PACKAGE="$(ls "$IN_DIR"/db-backup-*.tar.gz.gpg)"

echo "==> Descriptografando $PACKAGE"
gpg --batch --yes --decrypt --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
  --output "$WORK_DIR/package.tar.gz" "$PACKAGE"
tar -C "$WORK_DIR" -xzf "$WORK_DIR/package.tar.gz"

echo "==> Dump foi gerado em: $(cat "$WORK_DIR/dumped-at.txt")"

echo "==> 1) Prelude (extensions/unaccent, stubs de auth.uid/auth.role)"
psql "$RESTORE_DB_URL" --set ON_ERROR_STOP=1 -f "$SCRIPT_DIR/prelude.sql"

echo "==> 2) Roles (tolerante — roles reservados já existem no Postgres efêmero)"
psql "$RESTORE_DB_URL" -f "$WORK_DIR/roles.sql" || true

echo "==> 3) Schema public (tolerante — schema public já existe no Postgres efêmero)"
psql "$RESTORE_DB_URL" -f "$WORK_DIR/schema.sql"

echo "==> 4) Dados, com triggers normais desligados (session_replication_role=replica)"
psql "$RESTORE_DB_URL" -c "SET session_replication_role = replica;" -f "$WORK_DIR/data.sql"

echo "==> 5) Conferindo contagem de linhas contra o manifesto de origem"
psql "$RESTORE_DB_URL" -t -A -f "$SCRIPT_DIR/manifest.sql" > "$WORK_DIR/manifest-restaurado.json"

if ! diff <(jq -S . "$WORK_DIR/manifest.json") <(jq -S . "$WORK_DIR/manifest-restaurado.json") > "$WORK_DIR/manifest.diff"; then
  echo "FALHA: a contagem de linhas restaurada não bate com o dump de origem."
  echo "--- origem vs. restaurado ---"
  cat "$WORK_DIR/manifest.diff"
  exit 1
fi

echo "OK: restore de teste bateu com o manifesto de origem."
cat "$WORK_DIR/manifest-restaurado.json"
