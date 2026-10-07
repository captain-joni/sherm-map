import { Router } from 'express';
import type pg from 'pg';
import { PROBABLY_GONE } from '@sherm/shared';

export function adminMetricsRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const [status, countries, weekly, review, top, other] = await Promise.all([
      pool.query(`SELECT status, count(*)::int AS n FROM markers WHERE deleted_at IS NULL GROUP BY status`),
      pool.query(`
        SELECT m.country_code AS code, c.name_de AS name, count(*)::int AS n
        FROM markers m LEFT JOIN countries c ON c.code = m.country_code
        WHERE m.status = 'approved' AND m.deleted_at IS NULL AND m.country_code IS NOT NULL
        GROUP BY m.country_code, c.name_de ORDER BY n DESC, code`),
      // Einsendungen pro Woche der letzten 26 Wochen, auch Wochen ohne Einsendung
      pool.query(`
        SELECT to_char(w, 'YYYY-MM-DD') AS week, count(m.id)::int AS n
        FROM generate_series(date_trunc('week', now()) - interval '25 weeks', date_trunc('week', now()), interval '1 week') w
        LEFT JOIN markers m ON date_trunc('week', m.created_at) = w
        GROUP BY w ORDER BY w`),
      pool.query(`
        SELECT count(*) FILTER (WHERE status = 'approved')::int AS approved,
               count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
               extract(epoch FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY reviewed_at - created_at)) AS median_review_seconds
        FROM markers WHERE reviewed_at IS NOT NULL AND reviewed_at > now() - interval '90 days'`),
      pool.query(`
        SELECT id, title, like_count FROM markers
        WHERE status = 'approved' AND deleted_at IS NULL AND like_count > 0
        ORDER BY like_count DESC, id LIMIT 10`),
      pool.query(`
        SELECT
          (SELECT count(*)::int FROM reports WHERE status = 'open') AS open_reports,
          (SELECT count(*)::int FROM markers WHERE deleted_at IS NULL AND status = 'approved'
             AND gone_count >= $1 AND gone_count > $2 * still_there_count) AS probably_gone,
          (SELECT count(*)::int FROM markers WHERE deleted_at IS NOT NULL) AS deleted,
          (SELECT count(*)::int FROM photos) AS photos,
          (SELECT count(*)::int FROM photos WHERE starred) AS starred_photos,
          (SELECT min(created_at) FROM markers WHERE status = 'pending' AND deleted_at IS NULL) AS oldest_pending`,
        [PROBABLY_GONE.minGone, PROBABLY_GONE.ratio]),
    ]);

    const byStatus = Object.fromEntries(['pending', 'approved', 'rejected', 'hidden'].map(s => [s, 0]));
    for (const r of status.rows) byStatus[r.status] = r.n;
    const r = review.rows[0];
    const o = other.rows[0];

    res.json({
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      by_status: byStatus,
      countries: { count: countries.rows.length, top: countries.rows.slice(0, 15) },
      weekly_submissions: weekly.rows,
      review: {
        approval_rate: r.approved + r.rejected ? r.approved / (r.approved + r.rejected) : null,
        median_review_hours: r.median_review_seconds === null ? null : Math.round(Number(r.median_review_seconds) / 360) / 10,
      },
      top_liked: top.rows,
      open_reports: o.open_reports,
      probably_gone: o.probably_gone,
      deleted: o.deleted,
      photos: o.photos,
      starred_photos: o.starred_photos,
      oldest_pending: o.oldest_pending,
    });
  });

  return router;
}
