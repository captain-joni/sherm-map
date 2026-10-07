import { rm } from 'node:fs/promises';
import { Router } from 'express';
import type pg from 'pg';
import {
  bulkActionInput, idParam, SHERM_ACTIONS, shermActionInput, shermEditInput, shermListQuery,
  type SessionUser, type ShermAction,
} from '@sherm/shared';
import { z } from 'zod';
import { currentUser } from '../../auth/sessions.ts';
import { badRequest, forbidden, notFound } from '../../http/errors.ts';
import { body, params, query } from '../../http/validate.ts';
import { audit, inTransaction } from '../../services/audit.ts';
import { adminPhotoUrls, getAdminSherm, listAdminSherms } from '../../services/sherms.ts';
import { preEditPath } from '../../services/storage.ts';

// Löschen und Wiederherstellen dürfen nur Admins, der Rest auch Moderatoren
const ADMIN_ONLY: ReadonlySet<ShermAction> = new Set(['delete', 'restore']);
const NEARBY_METERS = 500;

export function adminShermsRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await listAdminSherms(pool, query(req, shermListQuery)));
  });

  // Alles, was man zum Prüfen braucht: Sherm, Sherms in der Nähe, andere Einsendungen derselben Quelle,
  // Meldungen und Verlauf
  router.get('/:id', async (req, res) => {
    const { id } = params(req, idParam);
    const sherm = await getAdminSherm(pool, id);
    if (!sherm) throw notFound('Sherm nicht gefunden');

    const [nearby, sameSource, reports, history] = await Promise.all([
      pool.query(`
        SELECT o.id, o.title, o.status, ST_Y(o.location::geometry) AS lat, ST_X(o.location::geometry) AS lng,
               round(ST_Distance(o.location, m.location))::int AS distance_m, ph.storage_key, ph.processed_at
        FROM markers m
        JOIN markers o ON o.id <> m.id AND o.deleted_at IS NULL AND o.status IN ('approved', 'pending')
                      AND ST_DWithin(o.location, m.location, $2)
        LEFT JOIN LATERAL (SELECT storage_key, processed_at FROM photos p
                           WHERE p.marker_id = o.id AND p.processed_at IS NOT NULL ORDER BY p.id LIMIT 1) ph ON true
        WHERE m.id = $1
        ORDER BY distance_m LIMIT 20`, [id, NEARBY_METERS]),
      sherm.source_hash
        ? pool.query(`SELECT id, title, status, created_at FROM markers
                      WHERE source_hash = $1 AND id <> $2 ORDER BY created_at DESC LIMIT 20`, [sherm.source_hash, id])
        : Promise.resolve({ rows: [] }),
      pool.query(`SELECT r.id, r.reason, r.comment, r.status, r.created_at, u.username AS resolved_by, r.resolved_at
                  FROM reports r LEFT JOIN users u ON u.id = r.resolved_by
                  WHERE r.marker_id = $1 ORDER BY r.created_at DESC`, [id]),
      pool.query(`SELECT id, username, action, details, created_at FROM audit_log
                  WHERE marker_id = $1 ORDER BY created_at DESC LIMIT 50`, [id]),
    ]);

    res.json({
      sherm,
      nearby: nearby.rows.map(({ storage_key, processed_at, ...n }) => ({
        ...n, thumb: storage_key ? adminPhotoUrls(storage_key, processed_at).thumb : null,
      })),
      same_source: sameSource.rows,
      reports: reports.rows,
      history: history.rows,
    });
  });

  router.patch('/:id', async (req, res) => {
    const user = currentUser(req);
    const { id } = params(req, idParam);
    const input = body(req, shermEditInput);

    await inTransaction(pool, async client => {
      const before = (await client.query(`
        SELECT title, description, place_name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
        FROM markers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
      if (!before) throw notFound('Sherm nicht gefunden');

      const changes: Record<string, [unknown, unknown]> = {};
      for (const key of ['title', 'description', 'place_name', 'lat', 'lng'] as const) {
        if (input[key] !== undefined && input[key] !== before[key]) changes[key] = [before[key], input[key]];
      }
      if (!Object.keys(changes).length) return;

      await client.query(`
        UPDATE markers SET
          title = coalesce($2, title),
          description = CASE WHEN $3::boolean THEN $4 ELSE description END,
          place_name = CASE WHEN $5::boolean THEN $6 ELSE place_name END,
          location = CASE WHEN $7::float8 IS NULL THEN location
                          ELSE ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography END,
          updated_at = now()
        WHERE id = $1`,
        [id, input.title ?? null, input.description !== undefined, input.description ?? null,
         input.place_name !== undefined, input.place_name ?? null, input.lat ?? null, input.lng ?? null]);
      await audit(client, user, 'edit', id, { changes });
    });

    res.json(await getAdminSherm(pool, id));
  });

  router.post('/bulk', async (req, res) => {
    const user = currentUser(req);
    const { ids, action, reason } = body(req, bulkActionInput);
    if (ADMIN_ONLY.has(action) && user.role !== 'admin') throw forbidden();

    const done = await inTransaction(pool, async client => {
      const ok: number[] = [];
      for (const id of ids) {
        if (await applyAction(client, user, id, action, reason ?? null, { bulk: true })) ok.push(id);
      }
      return ok;
    });
    if (action === 'approve') await deletePreEdits(pool, done);
    res.json({ updated: done.length, ids: done });
  });

  router.post('/:id/:action', async (req, res) => {
    const user = currentUser(req);
    const { id, action } = params(req, idParam.extend({ action: z.enum(SHERM_ACTIONS) }));
    const { reason } = body(req, shermActionInput);
    if (ADMIN_ONLY.has(action) && user.role !== 'admin') throw forbidden();

    const changed = await inTransaction(pool, client => applyAction(client, user, id, action, reason ?? null));
    if (!changed) throw notFound('Sherm nicht gefunden oder Aktion nicht möglich');
    if (action === 'approve') await deletePreEdits(pool, [id]);
    res.json(await getAdminSherm(pool, id));
  });

  return router;
}

// Führt eine Aktion aus und schreibt den Audit-Eintrag. false, wenn der Sherm nicht passt.
async function applyAction(
  client: pg.PoolClient, user: SessionUser, id: number, action: ShermAction, reason: string | null,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const current = (await client.query('SELECT status, deleted_at FROM markers WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!current) return false;
  const deleted = current.deleted_at !== null;
  if (deleted !== (action === 'restore')) return false; // gelöschte nur wiederherstellen, aktive nicht "wiederherstellen"
  if (action === 'reject' && !reason) throw badRequest('Bitte einen Grund für die Ablehnung angeben');

  switch (action) {
    case 'approve':
    case 'reject':
    case 'hide': {
      const status = { approve: 'approved', reject: 'rejected', hide: 'hidden' }[action];
      await client.query(
        `UPDATE markers SET status = $2, reject_reason = $3, reviewed_at = now(), reviewed_by = $4, updated_at = now()
         WHERE id = $1`, [id, status, action === 'approve' ? null : reason, user.id]);
      await audit(client, user, action, id, { from: current.status, to: status, ...(reason ? { reason } : {}), ...extra });
      break;
    }
    case 'delete':
      await client.query('UPDATE markers SET deleted_at = now(), updated_at = now() WHERE id = $1', [id]);
      await audit(client, user, 'delete', id, { status: current.status, ...extra });
      break;
    case 'restore':
      await client.query('UPDATE markers SET deleted_at = NULL, updated_at = now() WHERE id = $1', [id]);
      await audit(client, user, 'restore', id, extra);
      break;
  }
  return true;
}

// Nach der Freigabe wird das unbearbeitete Original eines bearbeiteten Fotos nicht mehr gebraucht
async function deletePreEdits(pool: pg.Pool, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const { rows } = await pool.query('SELECT storage_key FROM photos WHERE marker_id = ANY($1)', [ids]);
  for (const { storage_key } of rows) await rm(preEditPath(storage_key), { force: true });
}
