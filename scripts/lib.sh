# Gemeinsame Funktionen für backup.sh, restore.sh und restore-test.sh (wird per source geladen)
# Alle DB-Befehle laufen im Postgres-Container, Benutzer und DB kommen aus dessen Umgebung.
#   DB_CONTAINER   Containername; leer = "docker compose exec db" im Repo-Verzeichnis

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
UPLOADS_DIR=${UPLOADS_DIR:-/opt/nfs/sherm-map/uploads}
BACKUP_DIR=${BACKUP_DIR:-$REPO_DIR/backups}

log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die() { log "❌ $*"; exit 1; }

db_exec() {
  if [[ -n "${DB_CONTAINER:-}" ]]; then
    docker exec -i "$DB_CONTAINER" "$@"
  else
    (cd "$REPO_DIR" && docker compose exec -T db "$@")
  fi
}

# psql in Datenbank $1 (Default: POSTGRES_DB des Containers), SQL über stdin
db_psql() {
  db_exec sh -c 'psql -U "$POSTGRES_USER" -d "${1:-$POSTGRES_DB}" -XAtq -v ON_ERROR_STOP=1' sh "${1:-}"
}

# Zeilenzahl aller Tabellen als JSON, unabhängig von der Schema-Version
table_counts() {
  db_psql "${1:-}" <<'SQL'
SELECT coalesce(json_object_agg(table_name, n ORDER BY table_name), '{}') FROM (
  SELECT table_name,
         (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', table_name), false, true, '')))[1]::text::bigint AS n
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'spatial_ref_sys'
) t;
SQL
}

schema_version() {
  local has
  has=$(echo "SELECT to_regclass('public.schema_migrations') IS NOT NULL" | db_psql "${1:-}")
  if [[ $has == t ]]; then
    echo "SELECT coalesce(max(name), 'none') FROM schema_migrations" | db_psql "${1:-}"
  else
    echo legacy
  fi
}

json_field() { # json_field <datei> <feld>: einfacher Stringwert aus dem Manifest, ohne jq
  sed -n "s/^  \"$2\": \"\\([^\"]*\\)\".*/\\1/p" "$1"
}

# Entpackt ein Backup nach $2 und prüft alle Prüfsummen. Bricht bei Fehlern ab.
verify_backup() {
  local file=$1 work=$2
  [[ -f $file ]] || die "Backup nicht gefunden: $file"
  if [[ -f $file.sha256 ]]; then
    (cd "$(dirname "$file")" && sha256sum -c --quiet "$(basename "$file").sha256") || die "Prüfsumme der Backup-Datei stimmt nicht"
  fi
  tar -xzf "$file" -C "$work" || die "Backup lässt sich nicht entpacken"
  [[ -f $work/manifest.json && -f $work/db.dump && -f $work/tables.json ]] || die "Backup unvollständig"
  grep -q '"format": "sherm-backup"' "$work/manifest.json" || die "Keine Sherm-Backup-Datei"

  local expected actual
  expected=$(json_field "$work/manifest.json" db_dump_sha256)
  actual=$(sha256sum "$work/db.dump" | cut -d' ' -f1)
  [[ $expected == "$actual" ]] || die "db.dump beschädigt (Prüfsumme)"

  mkdir -p "$work/uploads"
  (cd "$work/uploads" && sha256sum -c --quiet ../uploads.sha256) || die "Uploads beschädigt (Prüfsummen)"
  log "✅ Backup-Datei ist vollständig: $(wc -l < "$work/uploads.sha256") Dateien, Schema $(json_field "$work/manifest.json" schema_version)"
}
