# CLAUDE.md

Guidance for Claude Code sessions in this repo.

- `task.md`: the user's original brief for the rebuild
- `rebuild.md`: the phased rebuild plan with status, decisions and **open questions**. Keep its status current.
- `docs/api.md`: the API reference
- `docs/operations.md`: backups, restore, export/import, migrations, container commands, the v1 → v2 cut-over
- `readme.md` (German): a short project overview

## What this is

**Sherm Map**: a public map of "Sherms" at https://map.sherm.fun.
- Anyone can submit a Sherm (location, photo, title) from the mobile-first PWA.
- Submissions are `pending` and invisible, including their photos, until a moderator approves them in the admin panel at `/admin`.
- Visitors can like a sherm, confirm "noch da" / "weg", and report it.

UI text and code comments are in German. Keep new user-facing strings German. Planning docs are in English.

**Branches:** `rebuild` holds v2. `main` held the cleaned-up v1 app until the cut-over, and gets v2 by merging `rebuild` (see the cut-over runbook in docs/operations.md).

## Layout

npm workspaces, all TypeScript, ESM:

| Path | What |
|---|---|
| `shared/` (`@sherm/shared`) | zod request schemas, response types, export format. `@sherm/shared/constants` has the zod-free constants |
| `backend/` (`@sherm/backend`) | Express 5 API + static serving + scripts. `src/app.ts` builds the app with injected `pool`/`cfg`, `src/server.ts` is the entry point |
| `web/` (`@sherm/web`) | Vite frontend, two entries: `index.html` → `src/map/` (public PWA) and `admin/index.html` → `src/admin/`. The service worker is `src/sw.ts` |
| `db/migrations/` | SQL migrations, applied automatically on server start |
| `scripts/` | host-side bash: `backup.sh`, `restore-test.sh`, `restore.sh` |
| `e2e/` | Playwright end-to-end tests; `e2e/server.ts` starts the app with a fresh DB |

## Conventions

- **TypeScript runs through `tsx`**; there's no backend build. `npm run typecheck` runs tsc (TS 7) with `noEmit`.
  - Imports use `.ts` extensions.
  - Use erasable syntax only: no enums, no namespaces, no parameter properties.
- **Migrations:** never edit an applied migration (the runner checks checksums); add a new `NNNN_*.sql` file.
- **Schema essentials:**
  - `markers.status` is pending/approved/rejected/hidden; `deleted_at` is the soft delete, purged after 30 days.
  - Photos live in `photos` and are stored as `uploads/{original,display,thumb}/<storage_key>`. `original/<key>.pre-edit.jpg` holds the pre-edit original until approval.
  - Triggers maintain `country_code` (from `country_parts`) and the like/"still there" counters (from `reactions`).
- **Backend:**
  - Every admin write calls `audit()`, inside `inTransaction()` when it changes data.
  - Validate with the zod schemas from `shared/src/api.ts` via `body()`/`query()`/`params()`.
  - Throw `HttpError` for user-facing messages; anything else becomes `Serverfehler`.
- **Frontend:**
  - DOM is built with `h()` from `web/src/lib/dom.ts`, textContent only, never innerHTML with data. Use `replace()` when children can be null.
  - **Import values from `@sherm/shared/constants`, types via `import type` from `@sherm/shared`.** Otherwise zod lands in the bundle, and `npm run build` fails on purpose.
  - Leaflet: import `L` from `web/src/map/leaflet.ts` (it sets the global for markercluster). Create maps on attached elements, or watch them with a ResizeObserver; otherwise their height is 0.
- **Security:**
  - The CSP lives in `backend/src/http/security.ts`. Tile hosts must be in `img-src` **and** `connect-src`, because the service worker fetches tiles.
  - Keep `referrerPolicy: strict-origin-when-cross-origin`: OSM returns 403 tiles without a Referer.
  - Admin auth is an httpOnly SameSite=Strict session cookie. Non-GET `/api` requests from other origins get 403.

## Running

```bash
npm install
docker run -d --rm --name sherm-pg -e POSTGRES_PASSWORD=t -p 127.0.0.1:55432:5432 postgis/postgis:15-3.3
# .env (see .env.example): DATABASE_URL=postgres://postgres:t@127.0.0.1:55432/postgres, HASH_SECRET=…, ADMIN_USER/ADMIN_PASS
npm run dev -w backend          # API on :3000, migrates on start
npm run dev -w web              # Vite on :5173, proxies /api and /media
npm run load-countries -w backend   # optional, for country names

npm run typecheck
TEST_DATABASE_URL=postgres://postgres:t@127.0.0.1:55432/postgres npm test     # 36 API/integration tests
npm run build && E2E_DATABASE_URL=postgres://postgres:t@127.0.0.1:55432/postgres npm run e2e
```

**Production:** `docker compose up -d --build` with a `.env` next to the compose file.
- The image is Node 24 Alpine and runs as user 1000.
- It sits behind an external Traefik (network `proxy`, host `map.sherm.fun`). The DB port is bound to 127.0.0.1 only.
- Pgdata, uploads and backups live under `/opt/nfs/sherm-map/` and `./backups`.
- On the existing prod DB, `POSTGRES_PASSWORD` must stay the original one. Never change `HASH_SECRET` once set.
- CI (`.github/workflows/ci.yml`) runs typecheck, tests, build, e2e and the Docker build.

## Gotchas

- Postgres rejects `\u0000`. The shared `cleanText` strips control characters.
- In zod 4, optional text fields must use `.nullish()`. A union containing `z.undefined()` makes the key required.
- With curl, use `--form-string` for values starting with `<` or `@`.
- `pkill -f <pattern>` kills the shell whose own command line contains the pattern. Kill by PID or PID file instead.
- `.button`, `.queue-chip` etc. set `display`; that's why `[hidden]` is forced to `display: none !important`.
- The local Node is 20 (end of life), which tsx handles fine. Docker and CI use Node 24.
