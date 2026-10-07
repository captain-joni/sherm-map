# CLAUDE.md

Guidance for Claude Code sessions in this repo.

- `task.md`: the user's brief for the rebuild
- `rebuild.md`: the phased rebuild plan, including decisions already made and open questions. **Read it before starting rebuild work**, and keep its status and checkboxes up to date.
- `readme.md` (German): the original idea and to-do list

## What this is

**Sherm Map**: a public map of "Sherms" at https://map.sherm.fun. Anyone can submit a Sherm (title, description, photo, coordinates). New submissions are **unvalidated**: they don't show on the map, and their photo isn't publicly reachable, until an admin reviews them in the admin panel and validates them.

UI text and code comments are in German. Keep new user-facing strings German. Planning docs are in English.

## Rebuild (branch `rebuild`)

The v2 code lives next to the v1 app until the cut-over. `main` stays the deployable v1 app.

- **npm workspaces**: `shared/` (`@sherm/shared`, zod schemas such as the export format) and `backend/` (`@sherm/backend`). The root `package.json` still carries the v1 dependencies.
- **TypeScript is run with `tsx`**; there's no build step. `npm run typecheck` runs tsc (TS 7) with `noEmit`.
  - Imports use `.ts` extensions.
  - Use erasable syntax only: no enums, no namespaces, no parameter properties.
  - ESM (`"type": "module"`).
- **Migrations**: `db/migrations/NNNN_name.sql`, applied by `npm run migrate -w backend`. **Never edit an applied migration**; the runner checks checksums. Add a new file instead.
- **v2 schema**: `markers.status` (pending/approved/rejected/hidden) replaces `validated`.
  - Photos live in the `photos` table and are stored as `uploads/{original,display,thumb}/<storage_key>`. `legacy_path` points to the v1 file until it has been reprocessed.
  - `country_code` is set by a trigger from the `country_parts` table.
  - Like and "still there" counters are maintained by a trigger on `reactions`.
- **Scripts**:
  - backend: `npm run {export,import,reprocess-images,load-countries} -w backend`
  - host, bash: `scripts/{backup,restore,restore-test}.sh`

  All are documented in `docs/operations.md`.
- **Tests**: `npm test -w backend`. Integration tests need a PostGIS server; they create and drop their own databases:
  ```bash
  docker run -d --rm --name sherm-pg -e POSTGRES_PASSWORD=t -p 127.0.0.1:55432:5432 postgis/postgis:15-3.3
  TEST_DATABASE_URL=postgres://postgres:t@127.0.0.1:55432/postgres npm test -w backend
  ```
- **Local Node is 20** (end of life). Everything runs on it via tsx, and the Docker target is Node 24.

## Current stack (v1, before the rebuild)

- **Backend**: Node 20 + Express 5, CommonJS, all in `server.js`.
  - `db.js` exports a `pg` Pool built from `DATABASE_URL`.
  - Security: helmet (CSP allows unpkg + OSM tiles), express-rate-limit, multer.
- **DB**: PostgreSQL 15 + PostGIS. The schema is in `db/init/01_schema.sql`, with tables `markers` (location is `GEOGRAPHY(POINT,4326)`) and `users`.
  - Postgres runs this file **only when it initialises an empty data dir**. Schema changes on prod need a manual migration until rebuild Phase 1 adds migrations.
- **Frontend**: plain HTML/CSS/JS, no build step, Leaflet 1.9.4 from unpkg (with SRI hashes).
  - `frontend/`: the map at `/`
  - `frontend/create/`: submission form at `/create/`, an ES module
  - `frontend/admin/`: login and moderation list at `/admin/`
- **TypeScript**: only `frontend/create/utils.ts`. Run `npm run build` (tsc) to compile it into `frontend/create/js/utils.js`, which is committed and is what the browser loads. Commit both files.
- **Uploads**: stored in `uploads/` (gitignored) under random UUID names. Only JPEG, PNG and WebP are accepted (checked by magic bytes), max 10 MB.
  - `/uploads/:file` is served **only if the marker is validated**.
  - Admins fetch any image via `/api/admin/uploads/:file` with the Bearer token; the admin UI shows it as a blob URL.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | none | DB ping (used by the Docker healthcheck) |
| GET | `/api/markers` | none, CORS open | validated markers only |
| GET | `/uploads/:file` | none | image, only if its marker is validated |
| POST | `/api/public/markers` | none, 20/h per IP | multipart `title (≤100), description (≤1000), lat, lng, image`; inserted as unvalidated, `author='Public'` |
| POST | `/api/login` | none, 10 per 15 min per IP | `{username,password}` → `{token}` (JWT HS256, 8h) |
| GET | `/api/admin/markers` | Bearer, role admin | all markers incl. `validated`, `created_at` |
| GET | `/api/admin/uploads/:file` | admin | any image |
| PATCH | `/api/admin/markers/:id/validate` | admin | `{validated: boolean}` |
| DELETE | `/api/admin/markers/:id` | admin | deletes the row **and** its image file |

Errors are always `{error: "<German message>"}`. Only messages from `httpError()`, multer limits or body-parser reach the client; everything else becomes `Serverfehler`.

## Config and running

All config comes from env vars. Copy `.env.example` to `.env`; it's gitignored and **never committed**.

| Var | Notes |
|---|---|
| `JWT_SECRET` | ≥32 chars, otherwise the server refuses to start |
| `ADMIN_USER`, `ADMIN_PASS` | Only used to create the admin if missing (≥12 chars). They **don't** change an existing user's password; use `node scripts/set-admin-password.js` for that. |
| `TRUST_PROXY` | 1 behind Traefik, 0 locally. Needed for correct rate-limit IPs. |
| `POSTGRES_*` | Used by compose for the db container and to build `DATABASE_URL` |

```bash
npm install
# local DB without the prod NFS volume:
docker run -d --name sherm-db -e POSTGRES_USER=shermadmin -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=shermmap \
  -p 127.0.0.1:5432:5432 -v "$PWD/db/init:/docker-entrypoint-initdb.d:ro" postgis/postgis:15-3.3
npm run dev        # node --watch server.js → http://localhost:3000
npm run check      # syntax check (there are no tests yet)
```

**Production**: `docker compose up -d --build` on the server, with a `.env` next to the compose file.
- Runs behind an **external Traefik** (network `proxy`, cert resolver `mytlschallenge`, host `map.sherm.fun`).
- Pgdata and uploads live on `/opt/nfs/sherm-map/`.
- The DB port is bound to `127.0.0.1` only.
- On the existing prod DB, `POSTGRES_PASSWORD` must stay the password the DB was created with.
- See rebuild.md Phase 0 for the first deploy of this version.

## Gotchas

- Postgres rejects `\u0000` in text. `cleanText()` in server.js strips control characters for that reason.
- Don't use `innerHTML` with data from the API. Build DOM nodes and set `textContent` (see `buildPopup` in `frontend/main.js` and `el()` in `frontend/admin/main.js`).
- The CSP blocks inline scripts and any script or image host not in the helmet config in server.js. Add a new CDN or tile server there first.
- The OSM tile server returns **403 without a `Referer` header** (Tile Usage Policy). Keep helmet's `referrerPolicy` at `strict-origin-when-cross-origin`. helmet's default `no-referrer` blanks the map.
- When testing with curl, use `--form-string` for values starting with `<` or `@`; with `-F`, curl reads them as files.
- `pkill -f 'node server.js'` also kills the shell running it. Use `pgrep` or kill by PID.

## Still open (current app)

These are left for the rebuild:
- No migrations, backups or tests.
- Admin auth is a JWT in localStorage.
- EXIF metadata (including GPS) is not stripped from photos.
- Coordinates are entered as text.
- The bottom-left buttons link to sherm.fun pages.
