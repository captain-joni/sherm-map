import { copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Router } from 'express';
import yazl from 'yazl';
import type pg from 'pg';
import { idParam, photoListQuery, starInput } from '@sherm/shared';
import { currentUser } from '../../auth/sessions.ts';
import { badRequest, notFound } from '../../http/errors.ts';
import { body, params, query } from '../../http/validate.ts';
import { audit } from '../../services/audit.ts';
import { processPhoto } from '../../services/images.ts';
import { toAdminPhoto } from '../../services/sherms.ts';
import { preEditPath, variantPath } from '../../services/storage.ts';
import { assertImage, imageUpload } from '../../services/uploads.ts';

export function adminPhotosRouter(pool: pg.Pool): Router {
  const router = Router();

  // Galerie: alle Fotos nicht gelöschter Sherms, neueste zuerst
  router.get('/', async (req, res) => {
    const f = query(req, photoListQuery);
    const where = ['m.deleted_at IS NULL'];
    const values: unknown[] = [];
    const add = (v: unknown) => `$${values.push(v)}`;
    if (f.status) where.push(`m.status = ${add(f.status)}`);
    if (f.country) where.push(`m.country_code = ${add(f.country)}`);
    if (f.starred !== undefined) where.push(`p.starred = ${add(f.starred)}`);

    const { rows } = await pool.query(`
      SELECT p.id, p.storage_key, p.width, p.height, p.starred, p.processed_at, p.created_at,
             m.id AS sherm_id, m.title, m.status, m.country_code, m.like_count,
             count(*) OVER () AS total
      FROM photos p JOIN markers m ON m.id = p.marker_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${add(f.page_size)} OFFSET ${add((f.page - 1) * f.page_size)}`, values);

    res.json({
      items: rows.map(r => ({
        ...toAdminPhoto(r),
        created_at: r.created_at.toISOString(),
        sherm: { id: r.sherm_id, title: r.title, status: r.status, country_code: r.country_code, like_count: r.like_count },
      })),
      total: rows[0] ? Number(rows[0].total) : 0,
      page: f.page,
      page_size: f.page_size,
    });
  });

  // Alle markierten Originale als ZIP (z.B. für Instagram). JPEGs sind schon komprimiert, daher "store".
  router.get('/starred.zip', async (req, res) => {
    const user = currentUser(req);
    const { rows } = await pool.query(`
      SELECT p.storage_key, m.id AS sherm_id, m.title FROM photos p JOIN markers m ON m.id = p.marker_id
      WHERE p.starred AND p.processed_at IS NOT NULL AND m.deleted_at IS NULL ORDER BY p.id`);
    const zip = new yazl.ZipFile();
    for (const r of rows) {
      const file = variantPath(r.storage_key, 'original');
      if (!existsSync(file)) continue;
      const slug = String(r.title).normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).toLowerCase();
      zip.addFile(file, `sherm-${r.sherm_id}-${slug || 'foto'}.jpg`, { compress: false });
    }
    zip.end();
    await audit(pool, user, 'download_starred', null, { count: rows.length });
    res.set('Content-Type', 'application/zip');
    res.attachment(`sherm-favoriten-${new Date().toISOString().slice(0, 10)}.zip`);
    zip.outputStream.pipe(res);
  });

  router.post('/:id/star', async (req, res) => {
    const user = currentUser(req);
    const { id } = params(req, idParam);
    const { starred } = body(req, starInput);
    const { rows } = await pool.query('UPDATE photos SET starred = $2 WHERE id = $1 RETURNING marker_id', [id, starred]);
    if (!rows[0]) throw notFound('Foto nicht gefunden');
    await audit(pool, user, starred ? 'star' : 'unstar', rows[0].marker_id, { photo_id: id });
    res.json({ id, starred });
  });

  // Bearbeitetes Bild (gedreht, zugeschnitten, unkenntlich gemacht) ersetzt alle Varianten.
  // Das unbearbeitete Original bleibt bis zur Freigabe als pre-edit erhalten.
  router.put('/:id/image', imageUpload.single('image'), async (req, res) => {
    const user = currentUser(req);
    const { id } = params(req, idParam);
    if (!req.file) throw badRequest('Bild fehlt');
    await assertImage(req.file.buffer);

    const photo = await findPhoto(pool, id);
    if (!existsSync(preEditPath(photo.storage_key)) && existsSync(variantPath(photo.storage_key, 'original'))) {
      await copyFile(variantPath(photo.storage_key, 'original'), preEditPath(photo.storage_key));
    }
    const meta = await processPhoto(req.file.buffer, photo.storage_key);
    await updatePhotoMeta(pool, id, meta);
    await audit(pool, user, 'photo_edit', photo.marker_id, { photo_id: id });
    res.json(await reload(pool, id));
  });

  // Bearbeitung zurücknehmen: pre-edit wird wieder das Original
  router.post('/:id/revert', async (req, res) => {
    const user = currentUser(req);
    const { id } = params(req, idParam);
    const photo = await findPhoto(pool, id);
    const preEdit = preEditPath(photo.storage_key);
    if (!existsSync(preEdit)) throw badRequest('Keine frühere Version vorhanden');

    const meta = await processPhoto(preEdit, photo.storage_key);
    await rm(preEdit);
    await updatePhotoMeta(pool, id, meta);
    await audit(pool, user, 'photo_revert', photo.marker_id, { photo_id: id });
    res.json(await reload(pool, id));
  });

  return router;
}

async function findPhoto(pool: pg.Pool, id: number) {
  const { rows } = await pool.query('SELECT id, storage_key, marker_id FROM photos WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Foto nicht gefunden');
  return rows[0] as { id: number; storage_key: string; marker_id: number };
}

async function updatePhotoMeta(pool: pg.Pool, id: number, meta: { width: number; height: number; bytes: number; sha256: string }) {
  await pool.query(
    'UPDATE photos SET width = $2, height = $3, bytes = $4, sha256 = $5, processed_at = now() WHERE id = $1',
    [id, meta.width, meta.height, meta.bytes, meta.sha256]);
}

async function reload(pool: pg.Pool, id: number) {
  const { rows } = await pool.query('SELECT id, storage_key, width, height, starred, processed_at FROM photos WHERE id = $1', [id]);
  return toAdminPhoto(rows[0]);
}
