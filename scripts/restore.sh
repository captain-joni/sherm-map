#!/usr/bin/env bash
# Stellt ein Backup auf DIESEM Server wieder her (Datenbank UND Uploads). Vorher wird der aktuelle
# Stand gesichert: DB als pre-restore-<zeit>.dump in $BACKUP_DIR, Uploads nach <UPLOADS_DIR>.pre-restore-<zeit>.
#   scripts/restore.sh <backup.tar.gz> [--force] [--yes]
#     --force  auch wenn DB oder Uploads schon Daten enthalten (sonst Abbruch)
#     --yes    ohne Rückfrage
# Läuft im Repo-Verzeichnis auf dem Server, stoppt dafür kurz den Backend-Container.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

file= force=0 yes=0
for arg in "$@"; do
  case $arg in
    --force) force=1 ;;
    --yes) yes=1 ;;
    -*) die "Unbekannte Option $arg" ;;
    *) file=$arg ;;
  esac
done
[[ -n $file ]] || die "Nutzung: scripts/restore.sh <backup.tar.gz> [--force] [--yes]"

work=$(mktemp -d)
at_exit 'rm -rf "$work"'
verify_backup "$file" "$work"

current=$(table_counts)
has_data=$(echo "SELECT to_regclass('public.markers') IS NOT NULL AND EXISTS (SELECT 1 FROM markers)" | db_psql 2>/dev/null || echo f)
uploads_used=$(find "$UPLOADS_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | head -1)
if [[ ($has_data == t || -n $uploads_used) && $force == 0 ]]; then
  die "DB oder Uploads enthalten schon Daten ($current). Mit --force wird der aktuelle Stand gesichert und ersetzt."
fi

if [[ $yes == 0 ]]; then
  echo "Backup:  $(json_field "$work/manifest.json" created_at), Tabellen $(cat "$work/tables.json")"
  echo "Aktuell: $current"
  read -r -p "Aktuelle Daten ersetzen? [ja/N] " answer
  [[ $answer == ja ]] || die "Abgebrochen"
fi

ts=$(date -u +%Y%m%d-%H%M%S)
[[ -n ${DB_CONTAINER:-} ]] || (cd "$REPO_DIR" && docker compose stop backend)

mkdir -p "$BACKUP_DIR"
log "Sichere aktuelle DB nach $BACKUP_DIR/pre-restore-$ts.dump"
db_exec sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_DIR/pre-restore-$ts.dump"

log "Ersetze Datenbank"
db_exec sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" -T template0 "$POSTGRES_DB"'
db_exec sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$work/db.dump" \
  || die "pg_restore fehlgeschlagen. Alter Stand liegt in $BACKUP_DIR/pre-restore-$ts.dump"

log "Ersetze Uploads"
mkdir -p "$UPLOADS_DIR"
if [[ -n $uploads_used ]]; then
  mkdir "$UPLOADS_DIR.pre-restore-$ts"
  find "$UPLOADS_DIR" -mindepth 1 -maxdepth 1 -exec mv -t "$UPLOADS_DIR.pre-restore-$ts" {} +
fi
cp -a "$work/uploads/." "$UPLOADS_DIR/"

actual=$(table_counts)
[[ $actual == "$(cat "$work/tables.json")" ]] || die "Zeilenzahlen nach dem Restore weichen ab: $actual"

[[ -n ${DB_CONTAINER:-} ]] || (cd "$REPO_DIR" && docker compose start backend)
log "✅ Wiederhergestellt: $actual"
