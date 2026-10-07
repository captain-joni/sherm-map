// Bilddateien. Öffentlich nur display/thumb von freigegebenen Sherms, Admins sehen alles.
import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { notFound } from '../http/errors.ts';
import { requireRole } from '../auth/sessions.ts';
import { PUBLIC_WHERE } from '../services/sherms.ts';
import { preEditPath, variantPath, type Variant } from '../services/storage.ts';

const KEY = '[A-Za-z0-9-]{8,64}';
const publicFile = z.object({
  variant: z.enum(['display', 'thumb']),
  file: z.string().regex(new RegExp(`^${KEY}\\.webp$`)),
});
const adminFile = z.object({
  variant: z.enum(['display', 'thumb', 'original', 'pre-edit']),
  file: z.string().regex(new RegExp(`^${KEY}\\.(webp|jpg)$`)),
});

const keyOf = (file: string) => file.slice(0, file.lastIndexOf('.'));

export function mediaRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get('/media/:variant/:file', async (req, res) => {
    const parsed = publicFile.safeParse(req.params);
    if (!parsed.success) throw notFound();
    const key = keyOf(parsed.data.file);

    const { rowCount } = await pool.query(
      `SELECT 1 FROM photos p JOIN markers m ON m.id = p.marker_id
       WHERE p.storage_key = $1 AND p.processed_at IS NOT NULL AND ${PUBLIC_WHERE}`, [key]);
    if (!rowCount) throw notFound();

    // ?v=... in der URL ändert sich bei jeder Neuverarbeitung, daher darf länger gecacht werden.
    // Nicht "immutable": wird ein Sherm versteckt, soll das Bild nach spätestens einer Stunde weg sein.
    res.sendFile(variantPath(key, parsed.data.variant as Variant), { maxAge: '1h', dotfiles: 'deny' });
  });

  router.get('/api/admin/media/:variant/:file', requireRole('moderator'), async (req, res) => {
    const parsed = adminFile.safeParse(req.params);
    if (!parsed.success) throw notFound();
    const { variant, file } = parsed.data;
    const key = keyOf(file);

    const { rowCount } = await pool.query('SELECT 1 FROM photos WHERE storage_key = $1', [key]);
    if (!rowCount) throw notFound();

    res.set('Cache-Control', 'private, max-age=300');
    const filePath = variant === 'pre-edit' ? preEditPath(key) : variantPath(key, variant);
    if (req.query.download !== undefined) {
      res.download(filePath, `sherm-${key}${file.slice(file.lastIndexOf('.'))}`);
    } else {
      res.sendFile(filePath);
    }
  });

  return router;
}
