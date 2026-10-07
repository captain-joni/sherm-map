# Sherm Map Rebuild Plan

Status:
- **Phase 0:** done. Production runs the cleaned-up v1 app.
- **Phase 1:** code done on branch `rebuild` and tested against a fake legacy DB. Still to do: the dress rehearsal with real prod data (1.5), and answers to open questions 1 and 2.
- **Phases 2–7:** not started.

Rebuild work happens on the **`rebuild` branch**. `main` stays deployable for hotfixes to the running v1 app.

Work through the phases **in order**. Phase 1 (data) has to be finished before anything touches production data. Each phase ends with a "Done when" checklist; tick it off before moving on.

## Decisions already made

| Topic | Decision |
|---|---|
| Stack | Keep **Express + PostgreSQL/PostGIS**. Backend and frontend move to **TypeScript**. Frontend is built with **Vite + vite-plugin-pwa**, no UI framework (vanilla TS, small components). Map stays **Leaflet**, plus **Leaflet.markercluster**. |
| Admin extras | Review queue, edit before approve, audit log, multiple moderators with roles |
| Public extras | Share link per sherm, "near me" button, offline + retry upload |
| Sherm extras | "Still there?" confirmations, likes |
| Not wanted (for now) | Multiple photos per sherm, nickname field, dark mode |

## Tech choices inside the stack

These are implementation details. Change them if there's a reason, but write the reason down here.

- **Validation**: `zod` schemas, shared between backend and frontend in `shared/`.
- **Runtime**: TypeScript runs through `tsx`, with no build step, and `tsc` is only used for typechecking (`npm run typecheck`). Code sticks to erasable syntax (no enums or namespaces), so it can later run on Node's native type stripping. The Docker image moves to Node 24 LTS; Node 20 is end of life.
- **Migrations**: a small runner of our own (`backend/src/db/migrate.ts`) over plain `.sql` files in `db/migrations/`. It uses an advisory lock, one transaction per file, and checksums that refuse edited migrations. It replaced the planned `node-pg-migrate`, because ~80 lines we fully control beat a dependency here. Migrations will run automatically on backend start (Phase 2). `db/init/01_schema.sql` is no longer used for new installs.
- **Images**: `sharp` on the server. Every upload is re-encoded, which strips EXIF (phones put the **GPS position and device info** into photos) and destroys any payload hidden in the file. Each upload produces:
  - `original/` at max 4096 px, high-quality JPEG, never public. This is the copy for Instagram.
  - `display/` at 1600 px WebP.
  - `thumb/` at 400 px WebP.
- **Countries**: Natural Earth **1:10m** admin-0 polygons (1:50m misses small islands such as Helgoland), pinned to v5.1.2 and checked by sha256. They're split with `ST_Subdivide` into `country_parts` so lookups are fast. A trigger sets `markers.country_code` on insert and on location change: the containing polygon, otherwise the nearest within 25 km. No external geocoding API, no rate limits, and it works for old data too.
- **Place search** (map search bar): the Photon API (photon.komoot.io), proxied through our backend at `/api/geocode` with caching, so the CSP stays tight and we respect its fair use.
- **Admin auth**: an httpOnly, `SameSite=Strict` session cookie instead of a JWT in localStorage. An XSS bug can then no longer steal admin sessions. Sessions are stored in Postgres, so a user can be logged out or disabled server-side.
- **Anonymous identity** for likes, "still there" and reports: a random device ID kept in localStorage, plus a **salted hash of the IP**. Raw IPs are never stored (DSGVO).
- **Tests**: `vitest` + `supertest` for the API, and Playwright for the key flows (submit, review, approve, view on map).
- **CI**: a GitHub Action that runs typecheck, tests and the Docker build.

## Target repository layout

```
backend/            Express API (TypeScript, npm workspace @sherm/backend)
  src/routes/       public.ts, admin.ts, auth.ts, share.ts          (Phase 2)
  src/services/     storage.ts, images.ts, photos.ts, audit.ts, ...
  src/db/           pool.ts, migrate.ts
  src/scripts/      export.ts, import.ts, reprocess-images.ts, load-countries.ts
  test/             vitest (integration tests need TEST_DATABASE_URL)
web/                Vite project, two entries (Phase 3). Not `frontend/`, which is the v1 app until cut-over.
  src/map/          public PWA
  src/admin/        admin app
shared/             zod schemas + types used by both (npm workspace @sherm/shared)
db/migrations/      0001_baseline.sql, 0002_v2_core.sql, 0003_countries.sql, ...
scripts/            backup.sh, restore.sh, restore-test.sh, lib.sh (bash, run on the host)
docs/               operations.md (backup/restore/export/migration runbook)

server.js, db.js, frontend/   the v1 app, deleted at cut-over (Phase 7)
```

---

## Phase 0: Safety net on production (before anything else)

Goal: production runs the cleaned-up current app, and there is a verified backup of the real data.

1. On the server, create `.env` from `.env.example`.
   - `POSTGRES_PASSWORD` **must be the existing password** (`shermpass`). Postgres only reads it when the data directory is created. To change it, run `ALTER USER shermadmin PASSWORD '...'` first.
   - Set a new random `JWT_SECRET` and a strong `ADMIN_PASS`.
2. Take a manual backup **before deploying**:
   ```bash
   docker compose exec -T db pg_dump -U shermadmin -Fc shermmap > sherm-$(date +%F).dump
   tar czf sherm-uploads-$(date +%F).tar.gz -C /opt/nfs/sherm-map uploads
   ```
   Copy both files off the server.
3. Deploy the cleaned-up version: `docker compose up -d --build`.
4. Reset the admin password, since the old account still has its old password:
   `docker compose exec backend node scripts/set-admin-password.js`
5. Check:
   - The map shows the validated sherms.
   - The admin login works.
   - `/uploads/<file of an unvalidated sherm>` returns 404.
   - Port 5432 is no longer reachable from outside.

**Done when:** prod runs the cleaned-up app, the admin password has been rotated, and a backup exists off the server.

---

## Phase 1: Data foundation, backup and migration (most important)

Goal: a schema that can grow safely, and backup, restore, export and import that are boring and tested.

### 1.1 Migrations
- `0001_baseline.sql` is exactly the current schema, written with `IF NOT EXISTS`. On existing prod it runs as a no-op and gets recorded; on a new install it creates the schema.
- From here on, every schema change is a new numbered migration, and old migrations are never edited.

### 1.2 New schema (`0002_...` onward)

```
markers
  id, title, description
  location GEOGRAPHY(POINT,4326)
  status        pending | approved | rejected | hidden   (replaces validated)
  country_code  CHAR(2), computed
  place_name    optional, e.g. "Heidelberg"
  reject_reason
  created_at, updated_at, reviewed_at, reviewed_by -> users
  deleted_at    soft delete, restorable for 30 days
  like_count, still_there_count, gone_count, last_confirmed_at   (denormalised counters)
  source_hash   hashed IP/device of the submitter, for rate limiting and spam cleanup

photos
  id, marker_id, storage_key, width, height, bytes, sha256
  starred       picked for Instagram
  created_at
  -- one photo per marker for now; the table allows more later

users
  id, username, password_hash
  role          moderator | admin
  disabled_at, last_login_at, created_at

sessions
  id, user_id, expires_at, created_at, user_agent

audit_log
  id, user_id, action, marker_id NULL, details JSONB, created_at
  -- action: approve, reject, edit, delete, restore, star, user_create, export, ...

reports
  id, marker_id
  reason        privacy | illegal | offensive | spam | wrong_location | other
  comment, reporter_hash
  status        open | resolved | dismissed
  created_at, resolved_by, resolved_at

reactions
  marker_id, kind (like | still_there | gone), voter_hash, created_at
  UNIQUE (marker_id, kind, voter_hash)

countries
  code, name_de, name_en, geom   -- Natural Earth, loaded by migration/seed
```

Migrating the existing rows:
- `validated=true` becomes `approved`, `validated=false` becomes `pending`.
- `image_path` becomes a `photos` row.
- `country_code` is backfilled from `countries`.
- Existing images are re-processed by `scripts/reprocess-images.ts` (EXIF strip, display/thumb variants). The untouched originals are kept until the migration is verified.

Indexes:
- GiST on `location`
- `pg_trgm` GIN on `title`, `description` and `place_name`, for admin search
- `(status, created_at)`
- `reports(status)`

### 1.3 Backup and restore
- `scripts/backup.sh` writes **one file** per run, `sherm-backup-<timestamp>.tar.gz` (plus a `.sha256` next to it), containing:
  - `db.dump` (`pg_dump -Fc`)
  - `uploads/` (all image variants)
  - `manifest.json` (schema version, row counts per table, number of files, sha256 of every file, app version)
- `scripts/restore.sh <file>` restores into an **empty** database and uploads directory, then checks the counts and checksums against the manifest. It refuses to overwrite non-empty targets unless given `--force`.
- Schedule: a host cron or systemd timer runs the backup nightly. Retention is 7 daily, 4 weekly and 6 monthly. A copy goes **off the server** (restic or rclone to a second machine or S3-compatible storage).
- A monthly automated **restore test**: restore the latest backup into a throwaway container and compare it with the manifest. An alert fires if it fails.
- Postgres data currently lives on NFS (`/opt/nfs/sherm-map/pgdata`). Postgres on NFS is a known corruption risk. The recommendation is local disk for `pgdata`, with backups going to NFS. See the open questions at the end.

### 1.4 Portable export and import
The second safety net works independently of the DB version and lets data move between old and new app versions or servers.
- `npm run export -w backend` writes `sherm-export-<timestamp>.tar.gz` containing:
  - `sherms.geojson`: every marker with all fields and its status, plus photo references
  - `photos/` (originals)
  - `audit_log.jsonl`, `reports.jsonl`
  - `manifest.json`
- `npm run import -w backend -- <file>` reads that archive into an empty or existing DB. It is idempotent: rows are matched by a stable `uuid` column added in 1.2.
- The same export is available as a download in the admin UI (admin role only, written to the audit log).

### 1.5 Dress rehearsal
Restore the Phase 0 prod backup locally, run all migrations, re-process the images, export, then import into a fresh DB. Compare the counts at every step.

**Done when:**
- [x] Migrations, backup, restore, restore test, export and import work against a fake legacy DB:
  - 3,000 sherms
  - images with EXIF, transparency, corrupt and missing files
  - reactions, reports and audit entries

  Covered by `backend/test/roundtrip.test.ts` and manual runs on 2026-10-07.
- [x] Export, import into an empty DB and export again gives the same data. The only expected difference is `reviewed_by`, since users aren't exported.
- [x] `docs/operations.md` describes all of this step by step.
- [ ] Migrations run without errors on a **copy of the real prod data** (1.5 dress rehearsal; needs a prod backup).
- [ ] Nightly backup cron and off-site copy are set up on the server (open questions 1 and 2).

---

## Phase 2: Backend v2 (TypeScript)

Goal: a new API on the new schema, with secure image handling and roles.

- Port to TypeScript under `backend/`. Every request body and query is validated with zod. Errors use one consistent JSON shape.
- Public API:
  - `GET /api/sherms?bbox=` returns approved sherms with only the fields the map needs, cached with an ETag.
  - `GET /api/sherms/:id` returns the details.
  - `POST /api/sherms` creates a sherm. It takes multipart data plus a client-generated `uuid` (idempotency key), so offline retries never create duplicates.
  - `POST /api/sherms/:id/reactions` takes `{kind}` for like, still there or gone.
  - `POST /api/sherms/:id/reports`
  - `GET /api/geocode?q=` is the Photon proxy.
- Images are served by storage key. `display` and `thumb` are public only for approved sherms; originals are admin-only.
- Admin API, all under the session cookie with role checks:
  - markers: list/search/filter, approve/reject/edit/delete/restore, bulk actions
  - photos: list, star, download original, replace (after a blur/crop edit)
  - reports, metrics, audit log, users (admin only), export (admin only)
- Every admin write goes through `audit.log()`.
- Rate limits:
  - submissions: 20/h per IP hash
  - reactions: 60/h
  - reports: 10/h
  - login: 10 per 15 min
- Spam honeypot: a hidden form field that bots fill in and humans don't.
- **Done when:**
  - The API test suite covers every route, including auth/role denial and validation failures.
  - The old frontend still works through a thin compatibility layer, or is switched over in the same release.

---

## Phase 3: Public map as a PWA (mobile first)

Goal: it feels like an app on a phone.

- Installable PWA: manifest, icons, splash and theme colour. The service worker caches the app shell, recently viewed tiles (capped) and `/api/sherms` (stale-while-revalidate).
- Full-screen map with **marker clustering**, which shows a count when zoomed out and splits up when zoomed in. Thumbnails load lazily.
- Tapping a sherm opens a **bottom sheet** instead of a Leaflet popup: half height, swipe up for the full view. It shows the photo, title, description, country, date, likes, "still there" status, share and report.
- Floating buttons for **"Near me"** (locate, accuracy circle, nearest sherms) and **"+"** (add a sherm).
- **Search**: a single search icon that expands into a search field. Results show sherms (by title or place) first, then places from Photon. It doesn't clutter the map when closed.
- **Share links**: `/s/:id` opens the map centred on that sherm with its sheet open. For link previews in WhatsApp, Instagram, Telegram and similar apps, the server renders `og:title` and `og:image` (the thumbnail) into the HTML for that URL. The share button uses the Web Share API, falling back to copying the link.
- Fix the bottom-left buttons (About and Impressum links), and add a Datenschutz page that covers uploads, EXIF stripping and IP hashing.
- **Done when:** the Lighthouse PWA and mobile audits are green, and the map runs smoothly with 5,000 test sherms on a mid-range phone.

---

## Phase 4: Add-sherm flow

Goal: adding a sherm on the spot takes under 30 seconds.

1. **Location**
   - "Use my location" calls `navigator.geolocation` with high accuracy, shows the accuracy circle, and lets the user drag the pin to fine-tune.
   - Alternatives: long-press on the map, or paste coordinates (the old format still works).
2. **Photo**: `<input type="file" accept="image/*" capture="environment">` opens the camera directly on phones and the file picker on desktop. This works more reliably across iOS and Android than a custom `getUserMedia` camera. The image is resized and compressed on the client (canvas, max 2048 px) before upload, which saves mobile data. The server still re-encodes it.
3. **Title and description**, then submit.
4. **Offline**: if the upload fails or the phone is offline, the submission (including the photo blob) is stored in IndexedDB and shown as "waiting for upload". It is retried via Background Sync where supported, and otherwise on the `online` event and on the next app start. The client-side `uuid` prevents duplicates.

**Done when:** the full flow works on iOS Safari and Android Chrome, including airplane mode followed by reconnecting.

---

## Phase 5: Community features

- **Likes**: a heart in the sheet, one per device or IP hash. The count is shown, and it feeds a "top sherms" list in the admin panel (and optionally public later).
- **Still there?**: "Still there" and "Gone" buttons in the sheet. The sheet shows "last confirmed: 3 weeks ago". If gone votes clearly outnumber still-there votes (threshold to be tuned), the sherm is shown greyed out as "probably gone" and flagged for the admins.
- **Report**: a "Melden" link in the sheet. The user picks a reason (privacy or a person visible, illegal, offensive, spam, wrong location, other) and can add an optional comment. Reports go to the admin reports inbox.

**Done when:** all three features have rate limits and tests, and show up in the admin panel.

---

## Phase 6: Admin rebuild

Goal: moderating is fast, works on a phone too, and is traceable.

Layout: an app shell with navigation (sidebar on desktop, bottom tabs on mobile).

1. **Dashboard / metrics**
   - Totals: all, approved, pending, rejected
   - Number of **countries**, plus a top-countries list
   - Submissions per week (chart)
   - Approval rate and median time to review
   - Open reports and "probably gone" count
   - Most-liked sherms
   - Maybe a small world map shaded by country
2. **Review queue**: unvalidated sherms one at a time, oldest first. Each card shows:
   - the photo
   - a **mini map** with the pin, plus already-approved sherms nearby
   - the coordinates and an "open in OSM" link
   - the country
   - the submitter's other recent submissions, by hash

   Actions: **Approve (A)**, **Reject (R)** with a reason, **Edit (E)**, **Skip (S)**. Swipe gestures on mobile.
3. **Edit before approve**:
   - Fix the title and description.
   - **Drag the pin** on the mini map.
   - Edit the photo: rotate, crop, and **blur a rectangle** (faces, licence plates). The edited photo replaces the public variants. The original is kept, admin-only, until the sherm is approved, then deleted if a blur was applied.
4. **All sherms**: a list or table with a **search bar** (full text over title, description and place) and filters for status, country, date, has photo, reported and probably gone. There's a map view of the same results. Bulk select allows approve, reject and delete.
5. **Gallery**: a thumbnail grid over all photos with infinite scroll and the same filters. Opening a photo shows it large. Photos can be **starred** for Instagram, the original can be downloaded, and all starred photos can be downloaded as a zip.
6. **Reports inbox**: open reports grouped by sherm, with resolve, dismiss and hide-sherm actions.
7. **Audit log**: a filterable list of who did what and when. Deletes can be undone from here within 30 days (soft delete).
8. **Users** (admin role):
   - Create a moderator with a one-time password that must be changed at first login.
   - Change a user's role, disable a user, log a user out everywhere.
9. **Backups** (admin role): show the last backup time and status, and offer the portable export download.

**Done when:** a moderator can clear a queue of 50 sherms on a phone without the desktop, and every action shows up in the audit log.

---

## Phase 7: Hardening and cut-over

- Playwright end-to-end tests for: submit (online and offline), review and approve, appears on the map, share link preview, report, like.
- CI runs on every push; a Docker image is built and tagged with the git SHA.
- Monitoring:
  - The `/api/health` check is wired into Traefik and Docker.
  - Backups and restore tests fail loudly (e-mail, Telegram or similar).
- Run the backend container as non-root. This needs a one-time `chown` of the uploads volume on the server.
- **Cut-over plan**:
  1. Run the Phase 0 backup steps.
  2. Put the site in maintenance mode.
  3. Deploy v2, which runs the migrations and image re-processing.
  4. Run smoke tests.
  5. Leave maintenance mode.
- **Rollback**: redeploy the old image and restore the pre-cut-over backup. Rehearse this once.

---

## Open questions and suggested ideas (not yet confirmed)

Answer these before or during the phase they belong to. Unconfirmed ideas don't get built.

1. **Postgres data off NFS** (Phase 1): move `pgdata` to local disk, with backups going to NFS. Recommended.
2. **Off-site backup target** (Phase 1): where should backups go? A second machine, a Hetzner Storage Box, S3, ...
3. **Duplicate warning** (Phase 6): in the review queue, warn when an approved sherm already exists within ~25 m.
4. **Auto-hide after reports** (Phase 5): hide a sherm automatically after N reports (e.g. 3) from different people until a moderator decides.
5. **New-submission notifications** (Phase 6): ping the moderators on new submissions or reports (web push to the installed admin PWA, a Telegram bot, or e-mail).
6. **Public stats page** (Phase 3): a fun page showing total sherms, countries and a top list, plus maybe "Sherm of the month".
7. **English UI** (Phase 3): German only, or German and English?
