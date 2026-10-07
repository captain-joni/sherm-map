import { Router } from 'express';
import type pg from 'pg';
import { auditListQuery } from '@sherm/shared';
import { query } from '../../http/validate.ts';

export function adminAuditRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const f = query(req, auditListQuery);
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (v: unknown) => `$${values.push(v)}`;
    if (f.user) where.push(`a.username = ${add(f.user)}`);
    if (f.action) where.push(`a.action = ${add(f.action)}`);
    if (f.sherm_id) where.push(`a.marker_id = ${add(f.sherm_id)}`);

    const { rows } = await pool.query(`
      SELECT a.id, a.username, a.action, a.marker_id AS sherm_id, m.title AS sherm_title, a.details, a.created_at,
             count(*) OVER () AS total
      FROM audit_log a LEFT JOIN markers m ON m.id = a.marker_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${add(f.page_size)} OFFSET ${add((f.page - 1) * f.page_size)}`, values);

    res.json({
      items: rows.map(({ total: _t, ...r }) => r),
      total: rows[0] ? Number(rows[0].total) : 0,
      page: f.page,
      page_size: f.page_size,
    });
  });

  return router;
}
