#!/usr/bin/env bash
set -euo pipefail

# Criptografa o pacote gerado por dump-and-package.sh (GPG, simétrico,
# AES256) e apaga o .tar.gz em texto claro.
#
# Isto não é opcional: o repositório FaciliteERP é público no GitHub, e
# artefatos de workflow em repositório público podem ser baixados por
# qualquer pessoa que veja o run — sem isto, o dump do banco (schema e
# dados de clientes/produtos/vendas) ficaria exposto publicamente.

: "${BACKUP_ENCRYPTION_PASSPHRASE:?defina BACKUP_ENCRYPTION_PASSPHRASE}"

OUT_DIR="backup-output"
PACKAGE="$(ls "$OUT_DIR"/db-backup-*.tar.gz)"

gpg --batch --yes --symmetric --cipher-algo AES256 \
  --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
  "$PACKAGE"

rm "$PACKAGE"
echo "Pacote criptografado: $PACKAGE.gpg"
