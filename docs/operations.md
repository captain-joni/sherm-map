# Operations runbook

How to back up, restore, export, import and migrate Sherm Map data. All commands run **on the server, in the repo directory**, unless noted otherwise.

## Overview

| Tool | What it's for | Contains |
|---|---|---|
| `scripts/backup.sh` | Nightly full backup, disaster recovery | DB dump (incl. users and passwords), all upload files, checksums |
| `scripts/restore-test.sh` | Proving a backup can be restored, without touching prod | – |
| `scripts/restore.sh` | Restoring a backup onto a server | – |
| `npm run export -w backend` | Portable, version-independent data export | Sherms, photos, reports, reactions and audit log as GeoJSON/JSONL + original photos. **No users.** |
| `npm run import -w backend` | Loading an export into another DB or app version | – |
| `npm run migrate -w backend` | Applying schema changes | – |

Use **backups** to get the same server back. Use the **export** to move data between app versions or servers, and as a second, human-readable safety net. Both are useful, and neither replaces the other.

## Backups

### How the backup works

`scripts/backup.sh` runs on the server, in the repo directory, normally once a night from cron:

1. **Database:** `pg_dump` runs inside the Postgres container and writes a complete dump (custom format). Then `pg_restore -l` checks that the dump is readable. The database keeps running the whole time; `pg_dump` sees one consistent snapshot.
2. **Row counts:** every table is counted and written to `tables.json`. The restore test later compares against these numbers.
3. **Uploads:** every file in the upload folder gets a sha256 checksum (`uploads.sha256`). The database is dumped *first*, so a photo uploaded during the backup can only be extra, never missing.
4. **One file:** dump, uploads, checksums and a `manifest.json` (schema version, dump checksum, number of files) are packed into **`sherm-backup-<UTC time>.tar.gz`**. It's written as `.partial` and only renamed when complete, plus a `.sha256` file next to it, so a half-written backup never looks finished.
5. **Retention:** old backups are deleted. Kept are the newest per day for 7 days, per week for 4 weeks and per month for 6 months, about 17 files in total.
6. **Optional:** `BACKUP_POST_HOOK` runs with the file path, e.g. a copy to a USB disk or a second disk.
7. **Reporting:** on any error, a message goes to the webhook (see *Notifications* below). Optionally successes are reported too.

`scripts/restore-test.sh` (monthly) proves that the newest backup really can be restored: it checks all checksums, restores the dump into a throwaway container and compares every row count. Production isn't touched.

Both scripts work with the old (v1) and the new schema.

### Settings

Each setting can be given as an **environment variable** or as a **line in `.env`** in the repo directory (the same file docker compose uses). The environment wins. The scripts read only these keys from `.env`; the file isn't executed.

| Setting | Default | Meaning |
|---|---|---|
| `BACKUP_DIR` | `./backups` | Where backups go. Relative paths are relative to the repo. Docker compose uses the same value to show the backup status in the admin panel |
| `UPLOADS_DIR` | `/opt/nfs/sherm-map/uploads` | Upload folder on the host |
| `KEEP_DAILY` / `KEEP_WEEKLY` / `KEEP_MONTHLY` | 7 / 4 / 6 | Retention |
| `BACKUP_POST_HOOK` | (empty) | Command after each successful backup, gets the file path as `$1` |
| `NOTIFY_WEBHOOK_URL` | (empty) | Webhook for error messages (e.g. n8n) |
| `NOTIFY_WEBHOOK_TOKEN` | (empty) | Sent as `Authorization: Bearer <token>` |
| `BACKUP_NOTIFY_SUCCESS` | `false` | `true` = also report successful backups and restore tests |
| `DB_CONTAINER` | (empty) | Environment only: use this container instead of `docker compose exec db` |

Example `.env` lines:

```bash
BACKUP_DIR=/srv/sherm-backups
NOTIFY_WEBHOOK_URL=https://n8n.example.org/webhook/sherm-map
NOTIFY_WEBHOOK_TOKEN=some-long-random-string
BACKUP_NOTIFY_SUCCESS=true
```

> **Where the backups live:** the database stays on NFS (decision 2026-10-07), and there's no second machine for off-site copies. So `BACKUP_DIR` should at least be on **different storage than `/opt/nfs/sherm-map/pgdata`**, e.g. the server's local disk. Then one broken storage device doesn't take the data *and* the backups with it. Ideally also copy the newest backup to a laptop or USB disk now and then.

### Scheduled backups (cron)

```cron
# Nightly backup at 03:15, monthly restore test on the 1st at 05:00 (settings come from .env)
15 3 * * *  cd /path/to/sherm-map && scripts/backup.sh >> /var/log/sherm-backup.log 2>&1
0 5 1 * *   cd /path/to/sherm-map && scripts/restore-test.sh >> /var/log/sherm-backup.log 2>&1
```

### Notifications (n8n)

The backup scripts and the backend send the same JSON shape to `NOTIFY_WEBHOOK_URL`:

```json
{ "source": "sherm-map", "event": "backup.failed", "host": "server1",
  "message": "Fehler bei „DB-Dump“: docker exec …", "at": "2026-10-07T03:15:02Z", ... }
```

| Event | Sent by | When |
|---|---|---|
| `backup.failed` / `restore_test.failed` | scripts | any error, including unexpected ones (the failing step is named) |
| `backup.succeeded` / `restore_test.succeeded` | scripts | only with `BACKUP_NOTIFY_SUCCESS=true` |
| `sherm.submitted` | backend | new sherm waiting for review. Includes `url` (review queue), `sherm.admin_url` and `pending_count` |
| `report.created` | backend | a visitor reported a sherm. Includes `url`, `sherm`, `report.reason`/`comment` |

`message` is always a ready-to-send German sentence, so the simplest n8n workflow is:

1. **Webhook** node (POST, path e.g. `sherm-map`, *Header Auth* with `Authorization: Bearer <token>`).
2. **Telegram** (or E-mail, Signal, Discord, …) node with text `{{ $json.body.message }}` plus `{{ $json.body.url }}` when present.
3. Optionally put an **IF/Switch** on `{{ $json.body.event }}` in between, e.g. backup errors to you, new sherms to the moderator group.

**"The backup didn't run at all"** (server down, cron broken) can't be reported by the script itself. For that:
- set `BACKUP_NOTIFY_SUCCESS=true`;
- in n8n, store the time of the last `backup.succeeded` (e.g. in a *Data Table* or static data);
- a second workflow with a **Schedule** trigger (daily at 09:00) alerts if that was more than 26 hours ago.

Independently of n8n, the admin panel (System page) warns when the newest backup is older than 36 hours.

### Testing a backup

```bash
scripts/restore-test.sh                       # newest backup in BACKUP_DIR
scripts/restore-test.sh backups/sherm-backup-20261007-031500.tar.gz
```

The script:
1. checks every checksum;
2. restores the dump into a throwaway PostGIS container;
3. compares the row count of every table with the backup.

Production is not touched. It needs Docker and pulls `postgis/postgis:15-3.3` if it's missing.

### Restoring a backup

```bash
scripts/restore.sh backups/sherm-backup-....tar.gz            # refuses if DB or uploads already have data
scripts/restore.sh backups/sherm-backup-....tar.gz --force    # replaces existing data
```

The script:
1. verifies the backup;
2. asks for confirmation (skip it with `--yes`);
3. stops the backend;
4. saves the **current** state:
   - the DB to `backups/pre-restore-<time>.dump`
   - the uploads to `<UPLOADS_DIR>.pre-restore-<time>/`
5. replaces the DB and the uploads;
6. compares the row counts;
7. starts the backend again.

Delete the `pre-restore` copies by hand once everything looks fine.

**Moving to a new server:**
1. Copy the repo and `.env` to the new server.
2. Run `docker compose up -d db`.
3. Run `scripts/restore.sh <backup> --force`.
4. Run `docker compose up -d`.

`POSTGRES_PASSWORD` in `.env` only needs to match the new, empty container. The restored data doesn't depend on it.

## Export and import

```bash
npm run export -w backend                          # -> backups/sherm-export-<time>.tar.gz
npm run export -w backend -- --out /some/dir
npm run export -w backend -- --allow-missing       # export even if photo files are missing (listed in the manifest)

npm run import -w backend -- path/to/sherm-export-....tar.gz --dry-run   # only validate the file
npm run import -w backend -- path/to/sherm-export-....tar.gz
```

- The format is defined in `shared/src/export-format.ts`. Each export contains:
  - `sherms.geojson`, one GeoJSON feature per sherm including status and photo references
  - `reports.jsonl`, `reactions.jsonl`, `audit_log.jsonl`
  - `photos/<storage_key>.jpg`
  - `manifest.json` with a sha256 for every file
- The import:
  - runs the migrations first;
  - skips anything that already exists, matched by `uuid`/`storage_key`, so it can run as often as needed;
  - never overwrites existing data;
  - rebuilds the like and "still there" counters from the reactions, then generates the image variants.
- Exports contain **no users**. `reviewed_by`/`resolved_by` are stored as usernames and only reconnect if a user with that name already exists in the target DB. The audit log always keeps the username as text.

## Schema migrations

- Migrations are plain SQL files: `db/migrations/NNNN_name.sql`. They run in order, each in its own transaction, and are recorded in `schema_migrations` with a checksum.
- **Never edit a migration that has been applied anywhere.** The runner refuses to start if a checksum changed. Make every change as a new file.
- `0001_baseline.sql` is the exact v1 schema with `IF NOT EXISTS`. On the existing production DB it changes nothing.
- **The backend applies pending migrations on every start**, using an advisory lock so two containers can't run them at the same time. To run them by hand: `docker compose exec backend npm run migrate -w backend`.

## Commands inside the container

The image contains the backend scripts. On the server, in the repo directory:

```bash
docker compose exec backend npm run load-countries -w backend      # load/refresh country polygons
docker compose exec backend npm run reprocess-images -w backend    # create missing image variants
docker compose exec backend npm run export -w backend -- --out /app/uploads/export   # export (lands in the uploads folder)
docker compose exec -it backend npm run set-password -w backend -- <username> [--admin]  # emergency: set a password / create an admin
```

Export and import also work from a developer machine with the repo checked out and `DATABASE_URL`/`UPLOADS_DIR` pointing at the right place.

## Production migration v1 → v2 (cut-over)

**Rehearse it first**: restore a prod backup locally (`scripts/restore.sh` with `DB_CONTAINER`, or into a local compose setup) and run steps 4–8 against it.

1. **Backup:** run `scripts/backup.sh`, then `scripts/restore-test.sh`. Copy the backup off the server.
2. **Keep the old image for rollback:** `docker tag $(docker compose images -q backend) sherm-map:v1`.
3. **Update `.env`:** add `HASH_SECRET` (`openssl rand -hex 32`) and `PUBLIC_URL`. `ADMIN_USER`/`ADMIN_PASS` can stay; existing users and their passwords are kept, since v1 already used bcrypt.
4. **Uploads ownership:** v2 runs as user 1000 (`node`) instead of root, so the folder needs `chown -R 1000:1000 /opt/nfs/sherm-map/uploads`.
   - If the NFS export doesn't allow `chown` (root_squash), change ownership on the NFS server instead, or as a stopgap add `user: "0:0"` to the backend service.
5. **Deploy:** `git pull` (main with v2), then `docker compose up -d --build`. On start, the backend migrates the DB: `validated` becomes `status`, images move into `photos`, and so on. Check with `docker compose logs backend`.
6. **Countries:** `docker compose exec backend npm run load-countries -w backend` (13 MB download).
7. **Images:** `docker compose exec backend npm run reprocess-images -w backend` strips EXIF and creates the original/display/thumb variants.
   - It lists photos that failed (corrupt or missing files) and old files that belong to no sherm.
   - Until this has run, old photos don't show up on the map.
8. **Smoke test:**
   - map loads, sherms with photos appear
   - `/admin` login works
   - review queue, a share link, and adding a test sherm all work
9. **Clean up, a few days later once everything is fine:** `docker compose exec backend npm run reprocess-images -w backend -- --delete-legacy` deletes the old v1 files.

**Rollback**:
1. `docker compose stop backend`
2. `scripts/restore.sh <backup from step 1> --force`
3. In docker-compose.yml, set `image: sherm-map:v1` and remove `build:` (or check out the old commit).
4. `docker compose up -d backend`

The v1 app can't read the migrated schema, so the restore is required.
