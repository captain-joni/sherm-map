#!/usr/bin/env bash
# Vollbackup in EINER Datei: DB-Dump (pg_dump -Fc), alle Uploads, Prüfsummen und Manifest.
#   scripts/backup.sh            ->  $BACKUP_DIR/sherm-backup-<UTC-Zeit>.tar.gz (+ .sha256)
# Einstellungen (BACKUP_DIR, Aufbewahrung, Webhook, ...) per Umgebung oder in der .env, siehe scripts/lib.sh.
# Bei Fehlern geht eine Meldung an NOTIFY_WEBHOOK_URL (event "backup.failed").
set -euo pipefail
source "$(dirname "$0")/lib.sh"
NOTIFY_EVENT=backup

[[ -d $UPLOADS_DIR ]] || die "UPLOADS_DIR existiert nicht: $UPLOADS_DIR"
mkdir -p "$BACKUP_DIR"
ts=$(date -u +%Y%m%d-%H%M%S)
out="$BACKUP_DIR/sherm-backup-$ts.tar.gz"
work=$(mktemp -d "$BACKUP_DIR/.work-XXXXXX")
at_exit 'rm -rf "$work" "$out.partial"'

# 1. Datenbank zuerst: Dateien, die währenddessen hochgeladen werden, landen dann höchstens zusätzlich im Backup
log "DB-Dump"
db_exec sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$work/db.dump"
db_exec pg_restore -l < "$work/db.dump" > /dev/null || die "pg_dump ist unlesbar"
table_counts > "$work/tables.json"
version=$(schema_version)

# 2. Uploads: Dateiliste + Prüfsummen, dieselbe Liste geht in das Archiv
log "Prüfsummen der Uploads"
(cd "$UPLOADS_DIR" && find . -type f ! -name '*.tmp' -print0 | sort -z) > "$work/files.list"
(cd "$UPLOADS_DIR" && xargs -0 -r sha256sum < "$work/files.list") > "$work/uploads.sha256"
files=$(tr -cd '\0' < "$work/files.list" | wc -c)

cat > "$work/manifest.json" <<JSON
{
  "format": "sherm-backup",
  "format_version": "1",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "host": "$(hostname)",
  "schema_version": "$version",
  "db_dump_sha256": "$(sha256sum "$work/db.dump" | cut -d' ' -f1)",
  "upload_files": "$files",
  "tables": $(cat "$work/tables.json")
}
JSON

log "Archiv schreiben ($files Dateien)"
tar -czf "$out.partial" -C "$work" manifest.json tables.json db.dump uploads.sha256 \
  -C "$UPLOADS_DIR" --null -T "$work/files.list" --transform 's,^\./,uploads/,'
mv "$out.partial" "$out"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256")
log "✅ $out ($(du -h "$out" | cut -f1), Tabellen: $(cat "$work/tables.json"))"

# 3. Aufbewahrung: pro Tag/Woche/Monat jeweils das neueste Backup behalten
prune() {
  local keep_d=${KEEP_DAILY:-7} keep_w=${KEEP_WEEKLY:-4} keep_m=${KEEP_MONTHLY:-6}
  local -A days=() weeks=() months=()
  local f stamp day week month keep
  while IFS= read -r f; do
    stamp=$(basename "$f" | sed -n 's/^sherm-backup-\([0-9]\{8\}\)-[0-9]\{6\}\.tar\.gz$/\1/p')
    [[ -n $stamp ]] || continue
    day=$stamp week=$(date -d "$stamp" +%G%V) month=${stamp:0:6} keep=0
    if [[ -z ${days[$day]:-} && ${#days[@]} -lt $keep_d ]]; then days[$day]=1; keep=1; fi
    if [[ -z ${weeks[$week]:-} && ${#weeks[@]} -lt $keep_w ]]; then weeks[$week]=1; keep=1; fi
    if [[ -z ${months[$month]:-} && ${#months[@]} -lt $keep_m ]]; then months[$month]=1; keep=1; fi
    if [[ $keep == 0 ]]; then
      log "Lösche altes Backup $(basename "$f")"
      rm -f "$f" "$f.sha256"
    fi
  done < <(ls -1 "$BACKUP_DIR"/sherm-backup-*.tar.gz 2>/dev/null | sort -r)
}
prune

if [[ -n ${BACKUP_POST_HOOK:-} ]]; then
  log "Post-Hook: $BACKUP_POST_HOOK"
  bash -c "$BACKUP_POST_HOOK \"\$1\"" _ "$out" || die "Post-Hook fehlgeschlagen"
fi

if [[ ${BACKUP_NOTIFY_SUCCESS:-false} == true ]]; then
  notify backup.succeeded "$(basename "$out") ($(du -h "$out" | cut -f1), $files Dateien)" "$out"
fi
