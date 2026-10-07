// Importiert einen portablen Export (sherm-export-*.tar.gz) in die DB. Idempotent: Sherms, Fotos,
// Meldungen, Reaktionen und Audit-Einträge, die es schon gibt (gleiche uuid/storage_key), werden
// übersprungen, nie überschrieben. Bringt das Schema vorher per Migration auf den neuesten Stand.
//   npm run import -w backend -- <datei.tar.gz> [--dry-run]
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as tar from 'tar';
import type pg from 'pg';
import { z } from 'zod';
import {
  exportAuditSchema, exportManifestSchema, exportReactionSchema, exportReportSchema, exportShermsSchema,
  type ExportManifest,
} from '@sherm/shared';
import { migrate } from '../db/migrate.ts';
import { processPendingPhotos } from '../services/photos.ts';
import { ensureStorageDirs, variantPath } from '../services/storage.ts';
import { isMain } from '../util.ts';
import { sha256File } from './export.ts';

export interface ImportResult {
  manifest: ExportManifest;
  inserted: { sherms: number; photos: number; reports: number; reactions: number; audit_log: number };
  photoErrors: string[];
}

async function readJsonl<T>(file: string, schema: z.ZodType<T>): Promise<T[]> {
  const text = await readFile(file, 'utf8');
  return text.split('\n').filter(Boolean).map((line, i) => {
    const parsed = schema.safeParse(JSON.parse(line));
    if (!parsed.success) throw new Error(`${path.basename(file)} Zeile ${i + 1}: ${z.prettifyError(parsed.error)}`);
    return parsed.data;
  });
}

// Entpacken und alles prüfen, bevor irgendetwas in die DB geht
async function readExport(archive: string, work: string) {
  await tar.extract({
    file: archive,
    cwd: work,
    strict: true,
    // nur normale Dateien und Ordner, keine Links (tar entfernt ../ und absolute Pfade ohnehin)
    filter: (_p, entry) => 'type' in entry && (entry.type === 'File' || entry.type === 'Directory'),
  });

  const manifest = exportManifestSchema.parse(JSON.parse(await readFile(path.join(work, 'manifest.json'), 'utf8')));
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const actual = await sha256File(path.join(work, rel)).catch(() => 'fehlt');
    if (actual !== expected) throw new Error(`Prüfsumme stimmt nicht: ${rel} (${actual})`);
  }

  const sherms = exportShermsSchema.parse(JSON.parse(await readFile(path.join(work, 'sherms.geojson'), 'utf8'))).features;
  for (const s of sherms) {
    for (const p of s.properties.photos) {
      if (!manifest.files[p.file]) throw new Error(`Foto ${p.file} steht nicht im Manifest`);
    }
  }

  return {
    manifest,
    sherms,
    reports: await readJsonl(path.join(work, 'reports.jsonl'), exportReportSchema),
    reactions: await readJsonl(path.join(work, 'reactions.jsonl'), exportReactionSchema),
    audit: await readJsonl(path.join(work, 'audit_log.jsonl'), exportAuditSchema),
  };
}

export async function importData(pool: pg.Pool, archive: string, { dryRun = false } = {}): Promise<ImportResult> {
  const work = await mkdtemp(path.join(os.tmpdir(), 'sherm-import-'));
  try {
    const data = await readExport(archive, work);
    const inserted = { sherms: 0, photos: 0, reports: 0, reactions: 0, audit_log: 0 };
    if (dryRun) return { manifest: data.manifest, inserted, photoErrors: [] };

    await migrate(pool);
    await ensureStorageDirs();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const users = new Map<string, number>(
        (await client.query('SELECT id, username FROM users')).rows.map(u => [u.username, u.id]));
      const userId = (name: string | null) => (name && users.get(name)) ?? null;

      // Sherms
      for (const { geometry, properties: s } of data.sherms) {
        const res = await client.query(
          `INSERT INTO markers (uuid, title, description, author, location, status, place_name, reject_reason,
                                created_at, updated_at, reviewed_at, reviewed_by, deleted_at, source_hash)
           VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7, $8, $9,
                   $10, $11, $12, $13, $14, $15)
           ON CONFLICT (uuid) DO NOTHING
           RETURNING id, country_code`,
          [s.uuid, s.title, s.description, s.author, geometry.coordinates[0], geometry.coordinates[1], s.status,
           s.place_name, s.reject_reason, s.created_at, s.updated_at, s.reviewed_at, userId(s.reviewed_by),
           s.deleted_at, s.source_hash]
        );
        const row = res.rows[0];
        if (!row) continue;
        inserted.sherms++;
        // Ohne geladene Länderpolygone bestimmt der Trigger nichts, dann den Wert aus dem Export behalten
        if (row.country_code === null && s.country_code) {
          await client.query('UPDATE markers SET country_code = $2 WHERE id = $1', [row.id, s.country_code]);
        }
      }

      const markerIds = new Map<string, number>(
        (await client.query('SELECT id, uuid FROM markers WHERE uuid = ANY($1)', [data.sherms.map(s => s.properties.uuid)]))
          .rows.map(m => [m.uuid, m.id]));
      const markerId = (uuid: string | null) => (uuid && markerIds.get(uuid)) ?? null;

      // Fotos: Datei als Original ablegen, die Varianten entstehen nach dem Commit
      for (const { properties: s } of data.sherms) {
        for (const p of s.photos) {
          const res = await client.query(
            `INSERT INTO photos (marker_id, storage_key, starred, created_at) VALUES ($1, $2, $3, $4)
             ON CONFLICT (storage_key) DO NOTHING RETURNING id`,
            [markerId(s.uuid), p.storage_key, p.starred, p.created_at]
          );
          if (!res.rows[0]) continue;
          await copyFile(path.join(work, p.file), variantPath(p.storage_key, 'original'));
          inserted.photos++;
        }
      }

      for (const r of data.reports) {
        const res = await client.query(
          `INSERT INTO reports (uuid, marker_id, reason, comment, reporter_hash, status, created_at, resolved_by, resolved_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (uuid) DO NOTHING`,
          [r.uuid, markerId(r.sherm_uuid), r.reason, r.comment, r.reporter_hash, r.status, r.created_at,
           userId(r.resolved_by), r.resolved_at]
        );
        inserted.reports += res.rowCount ?? 0;
      }

      // Zähler auf markers berechnet der Trigger aus den Reaktionen
      for (const r of data.reactions) {
        const res = await client.query(
          `INSERT INTO reactions (marker_id, kind, voter_hash, created_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [markerId(r.sherm_uuid), r.kind, r.voter_hash, r.created_at]
        );
        inserted.reactions += res.rowCount ?? 0;
      }

      for (const a of data.audit) {
        const res = await client.query(
          `INSERT INTO audit_log (uuid, user_id, username, action, marker_id, details, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (uuid) DO NOTHING`,
          [a.uuid, userId(a.username), a.username, a.action, markerId(a.sherm_uuid), a.details, a.created_at]
        );
        inserted.audit_log += res.rowCount ?? 0;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const { failed } = await processPendingPhotos(pool);
    return { manifest: data.manifest, inserted, photoErrors: failed };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'dry-run': { type: 'boolean', default: false } },
  });
  if (positionals.length !== 1) {
    console.error('Nutzung: npm run import -w backend -- <sherm-export-*.tar.gz> [--dry-run]');
    process.exit(2);
  }

  const { pool } = await import('../db/pool.ts');
  try {
    const result = await importData(pool, path.resolve(process.env.INIT_CWD ?? process.cwd(), positionals[0]!), { dryRun: values['dry-run'] });
    console.log(`Export vom ${result.manifest.created_at}, enthält ${JSON.stringify(result.manifest.counts)}`);
    if (values['dry-run']) {
      console.log('✅ Datei ist gültig (Dry Run, nichts importiert)');
    } else {
      console.log(`✅ Neu importiert: ${JSON.stringify(result.inserted)}`);
    }
    if (result.photoErrors.length) {
      console.error(`❌ ${result.photoErrors.length} Fotos konnten nicht verarbeitet werden:\n  ${result.photoErrors.join('\n  ')}`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
