import { Router } from 'express';
import type pg from 'pg';
import { idParam, reportListQuery, resolveReportInput } from '@sherm/shared';
import { currentUser } from '../../auth/sessions.ts';
import { notFound } from '../../http/errors.ts';
import { body, params, query } from '../../http/validate.ts';
import { audit, inTransaction } from '../../services/audit.ts';
import { adminPhotoUrls } from '../../services/sherms.ts';

export function adminReportsRouter(pool: pg.Pool): Router {
  const router = Router();

  // Meldungen, nach Sherm gruppiert: ein Eintrag pro Sherm mit allen passenden Meldungen
  router.get('/', async (req, res) => {
    const f = query(req, reportListQuery);
    const { rows } = await pool.query(`
      SELECT m.id, m.title, m.status, m.deleted_at, ph.storage_key, ph.processed_at,
             json_agg(json_build_object('id', r.id, 'reason', r.reason, 'comment', r.comment, 'created_at', r.created_at)
                      ORDER BY r.created_at DESC) AS reports,
             max(r.created_at) AS latest,
             count(*) OVER () AS total
      FROM reports r
      JOIN markers m ON m.id = r.marker_id
      LEFT JOIN LATERAL (SELECT storage_key, processed_at FROM photos p
                         WHERE p.marker_id = m.id AND p.processed_at IS NOT NULL ORDER BY p.id LIMIT 1) ph ON true
      WHERE r.status = $1
      GROUP BY m.id, ph.storage_key, ph.processed_at
      ORDER BY count(*) DESC, latest DESC
      LIMIT $2 OFFSET $3`, [f.status, f.page_size, (f.page - 1) * f.page_size]);

    res.json({
      items: rows.map(({ storage_key, processed_at, total: _t, latest: _l, ...r }) => ({
        ...r, thumb: storage_key ? adminPhotoUrls(storage_key, processed_at).thumb : null,
      })),
      total: rows[0] ? Number(rows[0].total) : 0,
      page: f.page,
      page_size: f.page_size,
    });
  });

  router.post('/:id/resolve', async (req, res) => {
    const user = currentUser(req);
    const { id } = params(req, idParam);
    const { status } = body(req, resolveReportInput);
    await inTransaction(pool, async client => {
      const { rows } = await client.query(
        `UPDATE reports SET status = $2, resolved_by = $3, resolved_at = now() WHERE id = $1 RETURNING marker_id`,
        [id, status, user.id]);
      if (!rows[0]) throw notFound('Meldung nicht gefunden');
      await audit(client, user, `report_${status}`, rows[0].marker_id, { report_id: id });
    });
    res.json({ success: true });
  });

  // Alle offenen Meldungen eines Sherms auf einmal erledigen
  router.post('/sherm/:id/resolve', async (req, res) => {
    const user = currentUser(req);
    const { id } = params(req, idParam);
    const { status } = body(req, resolveReportInput);
    const count = await inTransaction(pool, async client => {
      const { rowCount } = await client.query(
        `UPDATE reports SET status = $2, resolved_by = $3, resolved_at = now() WHERE marker_id = $1 AND status = 'open'`,
        [id, status, user.id]);
      if (rowCount) await audit(client, user, `report_${status}`, id, { count: rowCount });
      return rowCount ?? 0;
    });
    res.json({ updated: count });
  });

  return router;
}
