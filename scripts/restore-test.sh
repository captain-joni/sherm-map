#!/usr/bin/env bash
# Prüft, ob ein Backup wirklich wiederherstellbar ist, ohne die echte DB anzufassen:
# Prüfsummen checken, DB-Dump in einen Wegwerf-Container einspielen, Zeilenzahlen vergleichen.
#   scripts/restore-test.sh [backup.tar.gz]     (Default: neuestes Backup in $BACKUP_DIR)
# Exit-Code 0 = alles gut. Gedacht für einen monatlichen Cronjob mit Alarm bei Fehler.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

file=${1:-$(ls -1 "$BACKUP_DIR"/sherm-backup-*.tar.gz 2>/dev/null | sort | tail -1)}
[[ -n $file ]] || die "Kein Backup in $BACKUP_DIR gefunden"
image=${POSTGIS_IMAGE:-postgis/postgis:15-3.3}
container=sherm-restore-test-$$
work=$(mktemp -d)
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

log "Teste $file"
verify_backup "$file" "$work"

log "Starte Wegwerf-Postgres ($image)"
docker run -d --rm --name "$container" -e POSTGRES_USER=restore -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=restore \
  "$image" > /dev/null
export DB_CONTAINER=$container
# Bereit erst, wenn TCP antwortet: während des Init-Skripts des Images lauscht Postgres nur auf dem Socket
for _ in $(seq 90); do
  db_exec pg_isready -q -h 127.0.0.1 -U restore && break
  sleep 2
done
db_exec pg_isready -q -h 127.0.0.1 -U restore || die "Wegwerf-Postgres startet nicht"

log "Spiele Dump ein"
db_exec sh -c 'createdb -U "$POSTGRES_USER" -T template0 sherm_restore'
db_exec sh -c 'pg_restore -U "$POSTGRES_USER" -d sherm_restore --no-owner --exit-on-error' < "$work/db.dump" \
  || die "pg_restore fehlgeschlagen"

expected=$(cat "$work/tables.json")
actual=$(table_counts sherm_restore)
if [[ $expected != "$actual" ]]; then
  die "Zeilenzahlen weichen ab:
  Backup:        $expected
  Wiederhergest.: $actual"
fi
log "✅ Restore-Test bestanden: $actual"
