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

### Manual backup

```bash
scripts/backup.sh
```

This writes `backups/sherm-backup-<UTC time>.tar.gz` plus a `.sha256` file next to it. The archive contains:
- `db.dump` (`pg_dump -Fc`)
- `uploads/` (every file in the upload folder)
- `uploads.sha256`, the checksum of every upload
- `tables.json`, the row count of every table
- `manifest.json` (schema version, dump checksum, number of files)

It works with both the old (v1) and the new schema.

Settings, all via environment variables:

| Var | Default | Meaning |
|---|---|---|
| `BACKUP_DIR` | `<repo>/backups` | Where backups go |
| `UPLOADS_DIR` | `/opt/nfs/sherm-map/uploads` | Upload folder on the host |
| `DB_CONTAINER` | (empty) | Use this container instead of `docker compose exec db` |
| `KEEP_DAILY` / `KEEP_WEEKLY` / `KEEP_MONTHLY` | 7 / 4 / 6 | Retention. The newest backup per day, week and month is kept; everything else is deleted. |
| `BACKUP_POST_HOOK` | (empty) | Command run with the backup file path as its argument, e.g. a copy to another machine |

### Scheduled backups (cron)

```cron
# Nightly backup at 03:15, copy off the server via the hook
15 3 * * *  cd /path/to/sherm-map && BACKUP_POST_HOOK='rclone copy "$1" offsite:sherm-backups' scripts/backup.sh >> /var/log/sherm-backup.log 2>&1
# Monthly restore test on the 1st at 05:00
0 5 1 * *   cd /path/to/sherm-map && scripts/restore-test.sh >> /var/log/sherm-backup.log 2>&1
```

Both scripts exit with a non-zero code on any problem. Cron sends their output by mail if `MAILTO` is set. Proper alerting comes in rebuild Phase 7.

> **Off-site copy:** a backup on the same server (or the same NFS) doesn't help if that machine dies. The target is still an open question in rebuild.md: a second machine, a storage box or S3.

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
- The backend will run migrations on start (Phase 2). Until then, run them by hand:

```bash
npm run migrate -w backend
```

## Production migration v1 → v2 (cut-over, rehearse first!)

1. `scripts/backup.sh`, then `scripts/restore-test.sh`. Copy the backup off the server.
2. Stop the backend: `docker compose stop backend`.
3. `npm run migrate -w backend` turns `validated` into `status`, moves images into `photos`, and so on.
4. `npm run load-countries -w backend` loads the country polygons (13 MB download) and assigns a country to every sherm.
5. `npm run reprocess-images -w backend` strips EXIF and creates the original/display/thumb variants. It lists photos that failed (corrupt or missing files) and old files that belong to no sherm.
6. Check the result, then **after** a successful test of the new app: `npm run reprocess-images -w backend -- --delete-legacy`.
7. Deploy the v2 app.

**Rollback:** redeploy the old image and `scripts/restore.sh <backup from step 1> --force`.

Steps 3–5 need `DATABASE_URL` pointing at the DB, e.g. via the `127.0.0.1:5432` port binding, and `UPLOADS_DIR=/opt/nfs/sherm-map/uploads`. In Phase 2 they move into the backend container.
