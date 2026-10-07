// Portabler Export aller Daten als eine Datei (Format: shared/src/export-format.ts):
//   manifest.json, sherms.geojson, reports.jsonl, reactions.jsonl, audit_log.jsonl, photos/<key>.<ext>
//   npm run export -w backend -- [--out <ordner>] [--allow-missing]   (Default: <repo>/backups)
// Fehlt eine Fotodatei, bricht der Export ab. --allow-missing exportiert trotzdem und listet sie im Manifest.
// Enthält keine Benutzer/Passwörter, dafür ist das DB-Backup (scripts/backup.sh) da.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as tar from 'tar';
import type pg from 'pg';
import {
  EXPORT_FORMAT, EXPORT_FORMAT_VERSION,
  type ExportAudit, type ExportManifest, type ExportReaction, type ExportReport, type ExportSherm,
} from '@sherm/shared';
import { REPO_ROOT } from '../config.ts';
import { schemaVersion } from '../db/migrate.ts';
import { photoSourceFile } from '../services/storage.ts';
import { isMain } from '../util.ts';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function timestampForFilename(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export async function exportData(
  pool: pg.Pool, outDir: string, { allowMissing = false } = {},
): Promise<{ file: string; manifest: ExportManifest }> {
  const work = await mkdtemp(path.join(os.tmpdir(), 'sherm-export-'));
  try {
    await mkdir(path.join(work, 'photos'));
    const files: Record<string, string> = {};
    const missing: string[] = [];

    // Eine Transaktion mit REPEATABLE READ: alle Abfragen sehen denselben Datenstand
    const client = await pool.connect();
    let sherms: ExportSherm[], reports: ExportReport[], reactions: ExportReaction[], audit: ExportAudit[];
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

      const markers = await client.query(`
        SELECT m.id, m.uuid, m.title, m.description, m.author, m.status, m.country_code, m.place_name,
               m.reject_reason, m.created_at, m.updated_at, m.reviewed_at, u.username AS reviewed_by,
               m.deleted_at, m.source_hash, m.like_count, m.still_there_count, m.gone_count,
               ST_X(m.location::geometry) AS lng, ST_Y(m.location::geometry) AS lat
        FROM markers m LEFT JOIN users u ON u.id = m.reviewed_by
        ORDER BY m.id`);
      const photos = await client.query(
        'SELECT marker_id, storage_key, legacy_path, starred, created_at FROM photos ORDER BY id');

      const photosByMarker = new Map<number, ExportSherm['properties']['photos']>();
      for (const p of photos.rows) {
        // Das Original, bei noch nicht verarbeiteten v1-Fotos die alte Datei, wie sie ist
        const source = photoSourceFile(p.storage_key, p.legacy_path);
        if (!source) {
          missing.push(`${p.storage_key} (${p.legacy_path ?? 'original fehlt'})`);
          continue;
        }
        const ext = (path.extname(source).toLowerCase().match(/^\.[a-z0-9]+$/)?.[0]) ?? '.bin';
        const rel = `photos/${p.storage_key}${ext}`;
        await symlink(path.resolve(source), path.join(work, rel));
        files[rel] = await sha256File(source);

        const list = photosByMarker.get(p.marker_id) ?? [];
        list.push({ storage_key: p.storage_key, file: rel, starred: p.starred, created_at: iso(p.created_at)! });
        photosByMarker.set(p.marker_id, list);
      }

      const uuidById = new Map<number, string>(markers.rows.map(m => [m.id, m.uuid]));

      sherms = markers.rows.map(m => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
        properties: {
          uuid: m.uuid, title: m.title, description: m.description, author: m.author, status: m.status,
          country_code: m.country_code, place_name: m.place_name, reject_reason: m.reject_reason,
          created_at: iso(m.created_at)!, updated_at: iso(m.updated_at)!, reviewed_at: iso(m.reviewed_at),
          reviewed_by: m.reviewed_by, deleted_at: iso(m.deleted_at), source_hash: m.source_hash,
          like_count: m.like_count, still_there_count: m.still_there_count, gone_count: m.gone_count,
          photos: photosByMarker.get(m.id) ?? [],
        },
      }));

      reports = (await client.query(`
        SELECT r.*, u.username AS resolved_by_name FROM reports r
        LEFT JOIN users u ON u.id = r.resolved_by ORDER BY r.id`)).rows.map(r => ({
        uuid: r.uuid, sherm_uuid: uuidById.get(r.marker_id)!, reason: r.reason, comment: r.comment,
        reporter_hash: r.reporter_hash, status: r.status, created_at: iso(r.created_at)!,
        resolved_by: r.resolved_by_name, resolved_at: iso(r.resolved_at),
      }));

      reactions = (await client.query('SELECT * FROM reactions ORDER BY created_at, marker_id, kind')).rows.map(r => ({
        sherm_uuid: uuidById.get(r.marker_id)!, kind: r.kind, voter_hash: r.voter_hash, created_at: iso(r.created_at)!,
      }));

      audit = (await client.query('SELECT * FROM audit_log ORDER BY id')).rows.map(a => ({
        uuid: a.uuid, username: a.username, action: a.action,
        sherm_uuid: (a.marker_id !== null && uuidById.get(a.marker_id)) || null,
        details: a.marker_id !== null && !uuidById.has(a.marker_id) ? { ...a.details, deleted_marker_id: a.marker_id } : a.details,
        created_at: iso(a.created_at)!,
      }));

      await client.query('COMMIT');
    } finally {
      client.release();
    }

    if (missing.length && !allowMissing) {
      throw new Error(`${missing.length} Fotodateien fehlen, Export abgebrochen (mit --allow-missing trotzdem exportieren):\n  ${missing.join('\n  ')}`);
    }

    const writeJson = async (name: string, content: string) => {
      await writeFile(path.join(work, name), content);
      files[name] = createHash('sha256').update(content).digest('hex');
    };
    const jsonl = (rows: unknown[]) => rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');

    await writeJson('sherms.geojson', JSON.stringify({ type: 'FeatureCollection', features: sherms }, null, 1));
    await writeJson('reports.jsonl', jsonl(reports));
    await writeJson('reactions.jsonl', jsonl(reactions));
    await writeJson('audit_log.jsonl', jsonl(audit));

    const manifest: ExportManifest = {
      format: EXPORT_FORMAT,
      format_version: EXPORT_FORMAT_VERSION,
      created_at: new Date().toISOString(),
      schema_version: await schemaVersion(pool),
      counts: {
        sherms: sherms.length,
        photos: sherms.reduce((n, s) => n + s.properties.photos.length, 0),
        reports: reports.length,
        reactions: reactions.length,
        audit_log: audit.length,
      },
      files,
      missing_photos: missing,
    };
    await writeFile(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));

    await mkdir(outDir, { recursive: true });
    const file = path.join(path.resolve(outDir), `sherm-export-${timestampForFilename()}.tar.gz`);
    await tar.create({ gzip: true, file, cwd: work, follow: true, portable: true }, [
      'manifest.json', 'sherms.geojson', 'reports.jsonl', 'reactions.jsonl', 'audit_log.jsonl', 'photos',
    ]);
    return { file, manifest };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: path.join(REPO_ROOT, 'backups') },
      'allow-missing': { type: 'boolean', default: false },
    },
  });
  const { pool } = await import('../db/pool.ts');
  try {
    const { file, manifest } = await exportData(pool, path.resolve(process.env.INIT_CWD ?? process.cwd(), values.out!), {
      allowMissing: values['allow-missing'],
    });
    console.log(`✅ Export geschrieben: ${file}`);
    console.log(`   ${JSON.stringify(manifest.counts)}`);
    if (manifest.missing_photos.length) {
      console.warn(`⚠️  ${manifest.missing_photos.length} Fotos ohne Datei nicht exportiert:\n  ${manifest.missing_photos.join('\n  ')}`);
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
