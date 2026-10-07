// Integrationstest für Phase 1: Legacy-DB -> Migrationen -> Bilder -> Export -> Import in leere DB -> Export.
// Braucht ein Postgres mit PostGIS: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres
// Der Test legt eigene Datenbanken an und löscht sie danach wieder.
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import * as tar from 'tar';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL ??= ADMIN_URL ?? 'postgres://unused';

const { config } = await import('../src/config.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { processPendingPhotos } = await import('../src/services/photos.ts');
const { exportData } = await import('../src/scripts/export.ts');
const { importData } = await import('../src/scripts/import.ts');

const suffix = randomBytes(4).toString('hex');
const DBS = { source: `sherm_test_src_${suffix}`, target: `sherm_test_dst_${suffix}` };

function dbUrl(name: string): string {
  const url = new URL(ADMIN_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function readExport(file: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sherm-test-read-'));
  await tar.extract({ file, cwd: dir });
  const sherms = JSON.parse(await readFile(path.join(dir, 'sherms.geojson'), 'utf8')).features;
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  await rm(dir, { recursive: true });
  return { sherms, manifest };
}

describe.skipIf(!ADMIN_URL)('Phase 1: Migration, Export und Import', () => {
  const admin = new pg.Pool({ connectionString: ADMIN_URL });
  let source: pg.Pool, target: pg.Pool, tmp: string;

  beforeAll(async () => {
    for (const db of Object.values(DBS)) await admin.query(`CREATE DATABASE ${db}`);
    source = new pg.Pool({ connectionString: dbUrl(DBS.source) });
    target = new pg.Pool({ connectionString: dbUrl(DBS.target) });
    tmp = await mkdtemp(path.join(os.tmpdir(), 'sherm-test-'));
  });

  afterAll(async () => {
    await source?.end();
    await target?.end();
    for (const db of Object.values(DBS)) await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.end();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('migriert Legacy-Daten, entfernt EXIF und übersteht Export -> Import -> Export', async () => {
    // Legacy-Stand wie in Prod v1
    config.uploadsDir = path.join(tmp, 'uploads-src');
    const legacySql = await readFile(path.join(config.migrationsDir, '0001_baseline.sql'), 'utf8');
    await source.query(legacySql);
    await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#3a3' } })
      .jpeg().withExif({ IFD0: { Make: 'TestPhone' } })
      .toFile(path.join(tmp, 'legacy.jpg'));
    await import('node:fs/promises').then(fs => fs.mkdir(config.uploadsDir, { recursive: true }));
    await writeFile(path.join(config.uploadsDir, '1700000000000-IMG 1.JPG'), await readFile(path.join(tmp, 'legacy.jpg')));
    await source.query(`
      INSERT INTO users (username, password_hash) VALUES ('admin', 'x');
      INSERT INTO markers (title, description, validated, image_path, location, created_at) VALUES
        ('Mit Bild', 'ä ö ü 🙂', true, '/uploads/1700000000000-IMG 1.JPG', ST_SetSRID(ST_MakePoint(8.71, 49.41), 4326)::geography, '2026-01-10 12:00:00'),
        ('Ohne Bild', NULL, false, NULL, ST_SetSRID(ST_MakePoint(2.35, 48.85), 4326)::geography, '2026-02-01 08:30:00');
    `);

    const applied = await migrate(source, () => {});
    // 0001 läuft auf Legacy auch, ändert aber nichts (IF NOT EXISTS) und wird nur eingetragen
    expect(applied).toEqual(['0001_baseline.sql', '0002_v2_core.sql', '0003_countries.sql']);
    expect(await migrate(source, () => {})).toEqual([]);

    const markers = (await source.query('SELECT title, status, created_at FROM markers ORDER BY id')).rows;
    expect(markers.map(m => m.status)).toEqual(['approved', 'pending']);
    expect(markers[0].created_at.toISOString()).toBe('2026-01-10T12:00:00.000Z');

    const { total, failed } = await processPendingPhotos(source);
    expect({ total, failed }).toEqual({ total: 1, failed: [] });
    const { storage_key } = (await source.query('SELECT storage_key FROM photos')).rows[0];
    const meta = await sharp(path.join(config.uploadsDir, 'original', `${storage_key}.jpg`)).metadata();
    expect(meta.exif).toBeUndefined();

    await source.query(`
      INSERT INTO reactions (marker_id, kind, voter_hash) VALUES (1, 'like', 'a'), (1, 'like', 'b'), (2, 'gone', 'c');
      INSERT INTO reports (marker_id, reason, reporter_hash) VALUES (1, 'privacy', 'x');
      INSERT INTO audit_log (username, action, marker_id) VALUES ('admin', 'approve', 1);
    `);

    const first = await exportData(source, path.join(tmp, 'export1'));
    expect(first.manifest.counts).toEqual({ sherms: 2, photos: 1, reports: 1, reactions: 3, audit_log: 1 });

    // Import in eine leere DB mit eigenem Upload-Ordner, zweimal (idempotent)
    config.uploadsDir = path.join(tmp, 'uploads-dst');
    const imported = await importData(target, first.file);
    expect(imported.inserted).toEqual({ sherms: 2, photos: 1, reports: 1, reactions: 3, audit_log: 1 });
    expect(imported.photoErrors).toEqual([]);
    expect((await importData(target, first.file)).inserted).toEqual({ sherms: 0, photos: 0, reports: 0, reactions: 0, audit_log: 0 });

    const counts = (await target.query('SELECT like_count, gone_count FROM markers ORDER BY id')).rows;
    expect(counts).toEqual([{ like_count: 2, gone_count: 0 }, { like_count: 0, gone_count: 1 }]);

    const second = await exportData(target, path.join(tmp, 'export2'));
    const a = await readExport(first.file);
    const b = await readExport(second.file);
    // reviewed_by fehlt im Ziel (keine User im Export), sonst muss alles gleich sein
    const strip = (s: { properties: Record<string, unknown> }[]) => s.map(f => ({ ...f, properties: { ...f.properties, reviewed_by: null } }));
    expect(strip(b.sherms)).toEqual(strip(a.sherms));
    expect(b.manifest.files).toEqual(a.manifest.files);
  }, 120_000);
});
