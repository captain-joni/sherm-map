// Export und Backup-Übersicht, nur für Admins
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import type pg from 'pg';
import type { ServerConfig } from '../../config.ts';
import { currentUser } from '../../auth/sessions.ts';
import { audit } from '../../services/audit.ts';
import { exportData } from '../../scripts/export.ts';

export function adminSystemRouter(pool: pg.Pool, cfg: ServerConfig): Router {
  const router = Router();

  // Portabler Export als Download (Format siehe shared/src/export-format.ts)
  router.post('/export', async (req, res) => {
    const user = currentUser(req);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sherm-admin-export-'));
    try {
      const { file, manifest } = await exportData(pool, dir, { allowMissing: true });
      await audit(pool, user, 'export', null, { counts: manifest.counts, missing_photos: manifest.missing_photos.length });
      await new Promise<void>((resolve, reject) =>
        res.download(file, path.basename(file), err => (err ? reject(err) : resolve())));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Die Backups macht der Host (scripts/backup.sh). Ist BACKUP_DIR in den Container gemountet,
  // zeigt das Admin-Panel hier, wann das letzte lief.
  router.get('/backups', async (_req, res) => {
    let files: string[] = [];
    try {
      files = (await readdir(cfg.backupDir)).filter(f => /^sherm-backup-\d{8}-\d{6}\.tar\.gz$/.test(f)).sort().reverse();
    } catch {
      res.json({ available: false, backups: [] });
      return;
    }
    const backups = await Promise.all(files.slice(0, 30).map(async name => {
      const s = await stat(path.join(cfg.backupDir, name));
      return { name, bytes: s.size, created_at: s.mtime.toISOString() };
    }));
    res.json({ available: true, backups });
  });

  return router;
}
