# Gemeinsame Funktionen für backup.sh, restore.sh und restore-test.sh (wird per source geladen)
# Alle DB-Befehle laufen im Postgres-Container, Benutzer und DB kommen aus dessen Umgebung.
#
# Einstellungen (Umgebungsvariable > Zeile in <repo>/.env > Default):
#   BACKUP_DIR            Zielordner der Backups (Default: <repo>/backups; relativ = relativ zum Repo)
#   UPLOADS_DIR           Upload-Ordner auf dem Host (Default: /opt/nfs/sherm-map/uploads)
#   KEEP_DAILY/KEEP_WEEKLY/KEEP_MONTHLY   Aufbewahrung (Default 7/4/6)
#   BACKUP_POST_HOOK      Befehl nach jedem Backup, bekommt den Dateipfad als $1 (z.B. Kopie woanders hin)
#   NOTIFY_WEBHOOK_URL    Webhook (z.B. n8n), bekommt bei Fehlern ein JSON (siehe notify unten)
#   NOTIFY_WEBHOOK_TOKEN  optional, wird als "Authorization: Bearer <token>" mitgeschickt
#   BACKUP_NOTIFY_SUCCESS true = auch Erfolge melden (für "seit 26 h kein Backup"-Alarm in n8n)
#   DB_CONTAINER          Containername statt "docker compose exec db" (nur als Umgebungsvariable)

set -o errtrace
REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# Nur die Backup-Einstellungen aus der .env lesen (nicht die ganze Datei ausführen)
load_config() {
  local file=${SHERM_ENV_FILE:-$REPO_DIR/.env} line key value
  [[ -f $file ]] || return 0
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*(BACKUP_DIR|UPLOADS_DIR|KEEP_DAILY|KEEP_WEEKLY|KEEP_MONTHLY|BACKUP_POST_HOOK|NOTIFY_WEBHOOK_URL|NOTIFY_WEBHOOK_TOKEN|BACKUP_NOTIFY_SUCCESS|POSTGIS_IMAGE)=(.*)$ ]] || continue
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]%$'\r'}
    [[ $value =~ ^\"(.*)\"$ || $value =~ ^\'(.*)\'$ ]] && value=${BASH_REMATCH[1]}
    [[ -n ${!key+x} ]] && continue # Umgebung gewinnt
    printf -v "$key" '%s' "$value"
  done < "$file"
}
load_config

UPLOADS_DIR=${UPLOADS_DIR:-/opt/nfs/sherm-map/uploads}
BACKUP_DIR=${BACKUP_DIR:-$REPO_DIR/backups}
[[ $BACKUP_DIR == /* ]] || BACKUP_DIR=$(realpath -m "$REPO_DIR/$BACKUP_DIR")

LAST_STEP=start
log() { LAST_STEP=$*; printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
LAST_ERROR=
die() { LAST_ERROR=$*; log "❌ $*"; exit 1; }

json_escape() {
  local s=$1
  s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\t'/\\t}; s=${s//$'\r'/}; s=${s//$'\n'/\\n}
  printf '%s' "$s"
}

# notify <event> <message> [datei]: POST an NOTIFY_WEBHOOK_URL, z.B.
#   {"source":"sherm-map","event":"backup.failed","host":"server1","message":"...","file":null,"at":"2026-10-07T03:15:02Z"}
notify() {
  [[ -n ${NOTIFY_WEBHOOK_URL:-} ]] || return 0
  local file=null
  [[ -n ${3:-} ]] && file="\"$(json_escape "$3")\""
  local body
  body=$(printf '{"source":"sherm-map","event":"%s","host":"%s","message":"%s","file":%s,"at":"%s"}' \
    "$(json_escape "$1")" "$(json_escape "$(hostname)")" "$(json_escape "$2")" "$file" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
  local headers=(-H 'Content-Type: application/json')
  [[ -n ${NOTIFY_WEBHOOK_TOKEN:-} ]] && headers+=(-H "Authorization: Bearer $NOTIFY_WEBHOOK_TOKEN")
  curl -fsS -m 15 --retry 2 -X POST "${headers[@]}" -d "$body" "$NOTIFY_WEBHOOK_URL" > /dev/null \
    || log "⚠️  Benachrichtigung an den Webhook fehlgeschlagen"
}

# Aufräumen am Ende und bei Fehlern automatisch melden.
# Skripte registrieren Aufräumbefehle mit at_exit und setzen NOTIFY_EVENT (z.B. "backup").
EXIT_CMDS=()
at_exit() { EXIT_CMDS+=("$1"); }
_on_exit() {
  local code=$?
  for cmd in "${EXIT_CMDS[@]}"; do eval "$cmd" || true; done
  if [[ $code -ne 0 && -n ${NOTIFY_EVENT:-} ]]; then
    notify "$NOTIFY_EVENT.failed" "${LAST_ERROR:-Abbruch mit Exit-Code $code}"
  fi
  exit "$code"
}
trap _on_exit EXIT
trap 'LAST_ERROR=${LAST_ERROR:-"Fehler bei „$LAST_STEP“: $BASH_COMMAND"}' ERR

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
