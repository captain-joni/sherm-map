import { Router } from 'express';
import type pg from 'pg';
import type { ServerConfig } from '../../config.ts';
import { requireRole } from '../../auth/sessions.ts';
import { adminAuditRouter } from './audit.ts';
import { adminMetricsRouter } from './metrics.ts';
import { adminPhotosRouter } from './photos.ts';
import { adminReportsRouter } from './reports.ts';
import { adminShermsRouter } from './sherms.ts';
import { adminSystemRouter } from './system.ts';
import { adminUsersRouter } from './users.ts';

export function adminRouter(pool: pg.Pool, cfg: ServerConfig): Router {
  const router = Router();
  router.use(requireRole('moderator'));

  router.use('/sherms', adminShermsRouter(pool));
  router.use('/photos', adminPhotosRouter(pool));
  router.use('/reports', adminReportsRouter(pool));
  router.use('/metrics', adminMetricsRouter(pool));
  router.use('/audit', adminAuditRouter(pool));
  router.use('/users', requireRole('admin'), adminUsersRouter(pool));
  router.use('/system', requireRole('admin'), adminSystemRouter(pool, cfg));
  return router;
}
