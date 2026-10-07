# API v2

The input schemas and response types live in `shared/src/api.ts`, so the frontend can import them. All errors use the shape `{ "error": "<German message>", "details"?: ... }`. Validation errors (400) put zod's flattened errors in `details`.

## Conventions

- **Auth:** admin routes need the `sherm_session` cookie (httpOnly, SameSite=Strict), which `POST /api/auth/login` sets.
- **CSRF:** non-GET requests from another origin are rejected with 403, checked via `Origin` / `Sec-Fetch-Site`.
- **Roles:**
  - `moderator` can do everything under `/api/admin` except deleting/restoring sherms, `/users` and `/system`.
  - `admin` can do everything.
  - A user with `must_change_password` can only use `/api/auth/*` until they change it.
- **Image URLs** carry `?v=<version>`, which changes whenever an image is processed again, so they can be cached.
- **Rate limits** (per IP):

  | Action | Limit |
  |---|---|
  | Submissions | 20/h |
  | Reactions | 120/h |
  | Reports | 10/h |
  | Login | 10 per 15 min |
  | Place search | 30/min |

  Exceeding a limit returns 429.

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` (DB ping) |
| GET | `/api/sherms?bbox=w,s,e,n` | `MapSherm[]` for the map, approved only. `bbox` is optional and may cross the date line (w > e). CORS `*`, cached 60 s |
| GET | `/api/sherms/:id` | `PublicSherm`; 404 unless approved and not deleted |
| POST | `/api/sherms` | multipart: `uuid` (client-generated), `title`, `description?`, `lat`, `lng`, `image?`, `website` (honeypot, must stay empty). Returns 201 `{id, status: 'pending'}`; the same `uuid` again returns 200 with the existing sherm |
| POST | `/api/sherms/:id/reactions` | `{ kind: like\|still_there\|gone, device_id?: uuid }` → counters. "still there" and "gone" replace each other per voter |
| DELETE | `/api/sherms/:id/reactions/:kind?device_id=` | take a reaction back → counters |
| POST | `/api/sherms/:id/reports` | `{ reason, comment? }`, reasons: privacy, illegal, offensive, spam, wrong_location, other. One open report per person and sherm |
| GET | `/api/geocode?q=` | `GeocodeResult[]`, Photon proxy, cached 24 h |
| GET | `/media/{thumb,display}/<key>.webp` | images of approved sherms only |

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | `{username, password}` → `SessionUser` + cookie. Always the same error message, whatever the reason |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | `SessionUser` or 401 |
| POST | `/api/auth/password` | `{current_password, new_password (≥12)}`; logs out the user's other sessions |

## Admin (moderator+)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/sherms` | `Page<AdminSherm>`. Filters: `q` (text or `#id`), `status`, `country`, `from`, `to`, `has_photo`, `reported`, `probably_gone`, `deleted` (trash). `sort` = newest\|oldest\|likes\|reports; `page`, `page_size` ≤ 200 |
| GET | `/api/admin/sherms/:id` | `{ sherm, nearby (≤500 m), same_source (same submitter), reports, history (audit) }` |
| PATCH | `/api/admin/sherms/:id` | `{ title?, description?, place_name?, lat?+lng? }`; changes are logged in the audit log |
| POST | `/api/admin/sherms/:id/{approve,reject,hide}` | `reject` needs `{ reason }`. Approving deletes the pre-edit originals |
| POST | `/api/admin/sherms/:id/{delete,restore}` | **admin**. Soft delete; purged for good after 30 days |
| POST | `/api/admin/sherms/bulk` | `{ ids[], action, reason? }` → `{ updated, ids }` |
| GET | `/api/admin/media/{thumb,display,original,pre-edit}/<key>.<ext>` | any image; `?download` serves it as a download |
| GET | `/api/admin/photos` | gallery `Page`. Filters: `status`, `country`, `starred` |
| POST | `/api/admin/photos/:id/star` | `{ starred }` |
| PUT | `/api/admin/photos/:id/image` | multipart `image`: the edited photo replaces all variants; the old original is kept as pre-edit until approval |
| POST | `/api/admin/photos/:id/revert` | undo the photo edit |
| GET | `/api/admin/reports?status=open` | grouped by sherm |
| POST | `/api/admin/reports/:id/resolve` | `{ status: resolved\|dismissed }` |
| POST | `/api/admin/reports/sherm/:id/resolve` | resolve all open reports of a sherm |
| GET | `/api/admin/metrics` | totals, countries, weekly submissions (26 weeks), approval rate, median review time, top liked, open reports, probably gone, ... |
| GET | `/api/admin/audit` | filters `user`, `action`, `sherm_id` |

## Admin (admin only)

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/admin/users` | POST `{username, role}` → `{ user, one_time_password }` |
| PATCH | `/api/admin/users/:id` | `{ role?, disabled? }`. You can't disable or demote yourself. Disabling ends the user's sessions |
| POST | `/api/admin/users/:id/reset-password` | → `{ one_time_password }` |
| POST | `/api/admin/users/:id/logout-all` | |
| POST | `/api/admin/system/export` | portable export as a `.tar.gz` download |
| GET | `/api/admin/system/backups` | backups in `BACKUP_DIR`, if it's mounted into the container |
