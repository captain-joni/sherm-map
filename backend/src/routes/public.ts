import { randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import type pg from 'pg';
import {
  bboxQuery, createShermInput, geocodeQuery, idParam, reactionInput, reactionParams, reportInput,
} from '@sherm/shared';
import { notFound, HttpError } from '../http/errors.ts';
import type { createRateLimits } from '../http/rate-limits.ts';
import { body, params, query } from '../http/validate.ts';
import type { Geocoder } from '../services/geocode.ts';
import type { Hasher } from '../services/hashing.ts';
import { processPhoto, type ProcessedPhoto } from '../services/images.ts';
import { getPublicSherm, listMapSherms, PUBLIC_WHERE } from '../services/sherms.ts';
import { deletePhotoFiles } from '../services/storage.ts';
import { assertImage, imageUpload } from '../services/uploads.ts';
import { inTransaction } from '../services/audit.ts';
import type { Notify } from '../services/notify.ts';

const REPORT_REASON_LABELS: Record<string, string> = {
  privacy: 'Person/Kennzeichen erkennbar', illegal: 'Illegal', offensive: 'Anstößig',
  spam: 'Spam', wrong_location: 'Falscher Ort', other: 'Anderes',
};

interface Deps {
  pool: pg.Pool;
  publicUrl: string;
  notify: Notify;
  hasher: Hasher;
  limits: ReturnType<typeof createRateLimits>;
  geocode: Geocoder;
}

export function publicRouter({ pool, publicUrl, notify, hasher, limits, geocode }: Deps): Router {
  const router = Router();

  // Die öffentlichen Lesezugriffe dürfen auch andere Seiten nutzen (keine Cookies im Spiel)
  const openCors: RequestHandler = (_req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    next();
  };

  router.get('/sherms', openCors, async (req, res) => {
    const { bbox } = query(req, bboxQuery);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await listMapSherms(pool, bbox));
  });

  router.get('/sherms/:id', openCors, async (req, res) => {
    const { id } = params(req, idParam);
    const sherm = await getPublicSherm(pool, id);
    if (!sherm) throw notFound('Sherm nicht gefunden');
    res.set('Cache-Control', 'public, max-age=60');
    res.json(sherm);
  });

  // Neuer Sherm, landet als "pending" in der Prüfung
  router.post('/sherms', limits.submit, imageUpload.single('image'), async (req, res) => {
    const input = body(req, createShermInput);

    // Honeypot ausgefüllt: so tun als ob, nichts speichern
    if (input.website) {
      res.status(202).json({ id: null, status: 'pending' });
      return;
    }

    // Wiederholung aus der Offline-Warteschlange: dieselbe uuid liefert den bestehenden Sherm
    const existing = await pool.query('SELECT id, status FROM markers WHERE uuid = $1', [input.uuid]);
    if (existing.rows[0]) {
      res.status(200).json(existing.rows[0]);
      return;
    }

    let storageKey: string | null = null;
    let meta: ProcessedPhoto | null = null;
    if (req.file) {
      await assertImage(req.file.buffer);
      storageKey = randomUUID();
      try {
        meta = await processPhoto(req.file.buffer, storageKey);
      } catch {
        await deletePhotoFiles(storageKey);
        throw new HttpError(400, 'Bild konnte nicht verarbeitet werden');
      }
    }

    try {
      const created = await inTransaction(pool, async client => {
        const { rows } = await client.query(
          `INSERT INTO markers (uuid, title, description, location, status, author, source_hash)
           VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 'pending', 'Public', $6)
           RETURNING id, status`,
          [input.uuid, input.title, input.description, input.lng, input.lat, hasher.ip(req)]
        );
        if (storageKey && meta) {
          await client.query(
            `INSERT INTO photos (marker_id, storage_key, width, height, bytes, sha256, processed_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())`,
            [rows[0].id, storageKey, meta.width, meta.height, meta.bytes, meta.sha256]
          );
        }
        return rows[0];
      });
      res.status(201).json(created);
      void notifySubmitted(created.id, input.title, storageKey !== null);
    } catch (err) {
      if (storageKey) await deletePhotoFiles(storageKey);
      // Gleichzeitige Wiederholung mit derselben uuid
      if ((err as { code?: string }).code === '23505') {
        const again = await pool.query('SELECT id, status FROM markers WHERE uuid = $1', [input.uuid]);
        if (again.rows[0]) {
          res.status(200).json(again.rows[0]);
          return;
        }
      }
      throw err;
    }
  });

  async function notifySubmitted(id: number, title: string, hasPhoto: boolean) {
    const { rows } = await pool.query(`
      SELECT c.name_de AS country, (SELECT count(*)::int FROM markers WHERE status = 'pending' AND deleted_at IS NULL) AS pending
      FROM markers m LEFT JOIN countries c ON c.code = m.country_code WHERE m.id = $1`, [id]).catch(() => ({ rows: [] }));
    const country = rows[0]?.country ?? null;
    const pending = rows[0]?.pending ?? null;
    notify('sherm.submitted', {
      message: `Neuer Sherm zum Prüfen: „${title}“${country ? ` (${country})` : ''}${pending ? ` – ${pending} warten insgesamt` : ''}`,
      url: `${publicUrl}/admin/pruefen`,
      sherm: { id, title, country, has_photo: hasPhoto, admin_url: `${publicUrl}/admin/sherms/${id}` },
      pending_count: pending,
    });
  }

  router.post('/sherms/:id/reactions', limits.reaction, async (req, res) => {
    const { id } = params(req, idParam);
    const { kind, device_id } = body(req, reactionInput);
    const voter = hasher.voter(req, device_id);

    const counts = await inTransaction(pool, async client => {
      await assertPublic(client, id);
      // "Noch da" und "weg" schließen sich pro Person aus
      if (kind !== 'like') {
        await client.query('DELETE FROM reactions WHERE marker_id = $1 AND voter_hash = $2 AND kind = $3',
          [id, voter, kind === 'gone' ? 'still_there' : 'gone']);
      }
      await client.query(
        'INSERT INTO reactions (marker_id, kind, voter_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, kind, voter]
      );
      return reactionCounts(client, id);
    });
    res.json(counts);
  });

  router.delete('/sherms/:id/reactions/:kind', limits.reaction, async (req, res) => {
    const { id, kind } = params(req, reactionParams);
    const deviceId = typeof req.query.device_id === 'string' ? req.query.device_id : undefined;
    const { device_id } = reactionInput.pick({ device_id: true }).parse({ device_id: deviceId });
    const voter = hasher.voter(req, device_id);

    const counts = await inTransaction(pool, async client => {
      await assertPublic(client, id);
      await client.query('DELETE FROM reactions WHERE marker_id = $1 AND kind = $2 AND voter_hash = $3', [id, kind, voter]);
      return reactionCounts(client, id);
    });
    res.json(counts);
  });

  router.post('/sherms/:id/reports', limits.report, async (req, res) => {
    const { id } = params(req, idParam);
    const { reason, comment } = body(req, reportInput);
    const reporter = hasher.ip(req);

    const title = await inTransaction(pool, async client => {
      await assertPublic(client, id);
      // Pro Person und Sherm nur eine offene Meldung
      const open = await client.query(
        `SELECT 1 FROM reports WHERE marker_id = $1 AND reporter_hash = $2 AND status = 'open'`, [id, reporter]);
      if (open.rowCount) return null;
      await client.query(
        'INSERT INTO reports (marker_id, reason, comment, reporter_hash) VALUES ($1, $2, $3, $4)',
        [id, reason, comment, reporter]
      );
      return (await client.query('SELECT title FROM markers WHERE id = $1', [id])).rows[0].title as string;
    });
    res.status(201).json({ success: true });
    if (title) {
      notify('report.created', {
        message: `Sherm gemeldet: „${title}“ – Grund: ${REPORT_REASON_LABELS[reason]}${comment ? ` („${comment}“)` : ''}`,
        url: `${publicUrl}/admin/meldungen`,
        sherm: { id, title, admin_url: `${publicUrl}/admin/sherms/${id}` },
        report: { reason, comment },
      });
    }
  });

  router.get('/geocode', limits.geocode, async (req, res) => {
    const { q } = query(req, geocodeQuery);
    try {
      res.set('Cache-Control', 'public, max-age=3600');
      res.json(await geocode(q));
    } catch (err) {
      console.error('Geocoder:', (err as Error).message);
      throw new HttpError(502, 'Ortssuche gerade nicht erreichbar');
    }
  });

  return router;
}

async function assertPublic(db: Pick<pg.Pool, 'query'>, id: number): Promise<void> {
  const { rowCount } = await db.query(`SELECT 1 FROM markers m WHERE ${PUBLIC_WHERE} AND m.id = $1 FOR UPDATE`, [id]);
  if (!rowCount) throw notFound('Sherm nicht gefunden');
}

async function reactionCounts(db: Pick<pg.Pool, 'query'>, id: number) {
  const { rows } = await db.query(
    'SELECT like_count, still_there_count, gone_count, last_confirmed_at FROM markers WHERE id = $1', [id]);
  return rows[0];
}
