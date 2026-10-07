// Testumgebung: eigene Datenbank + eigener Upload-Ordner pro Testdatei, App mit Test-Config.
// Braucht TEST_DATABASE_URL (Postgres mit PostGIS, Rechte zum Anlegen von Datenbanken).
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import request from 'supertest';

export const ADMIN_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL ??= ADMIN_URL ?? 'postgres://unused';

const { config, loadServerConfig } = await import('../src/config.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { createApp } = await import('../src/app.ts');
const { ensureAdmin } = await import('../src/services/maintenance.ts');

export const ADMIN = { username: 'admin', password: 'admin-password-123' };

function dbUrl(name: string): string {
  const url = new URL(ADMIN_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function setupTestApp({ rateLimitScale = 100 } = {}) {
  const name = `sherm_test_api_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: ADMIN_URL });
  await admin.query(`CREATE DATABASE ${name}`);
  const pool = new pg.Pool({ connectionString: dbUrl(name) });
  const uploads = await mkdtemp(path.join(os.tmpdir(), 'sherm-test-uploads-'));
  config.uploadsDir = uploads;

  await migrate(pool, () => {});
  const cfg = loadServerConfig({
    NODE_ENV: 'test',
    HASH_SECRET: 'test-secret-test-secret-test-secret!',
    PUBLIC_URL: 'http://localhost:3000',
    ADMIN_USER: ADMIN.username,
    ADMIN_PASS: ADMIN.password,
    WEB_DIST: path.join(uploads, 'no-web-dist'),
    BACKUP_DIR: path.join(uploads, 'no-backups'),
  });
  await ensureAdmin(pool, cfg);

  const geocodeCalls: string[] = [];
  const app = createApp({
    pool, cfg, rateLimitScale,
    geocode: async q => {
      geocodeCalls.push(q);
      return [{ name: 'Heidelberg', detail: 'Baden-Württemberg, Deutschland', lat: 49.4, lng: 8.7 }];
    },
  });

  return {
    app, pool, cfg, uploads, geocodeCalls,
    async cleanup() {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
      await rm(uploads, { recursive: true, force: true });
    },
  };
}

export async function loginAgent(app: Parameters<typeof request.agent>[0], username: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`Login ${username} fehlgeschlagen: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

// JPEG mit EXIF (Kamera + GPS), wie es von einem Handy kommt
export function phoneJpeg(color = '#c33', width = 2400, height = 1600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestPhone', Model: 'X' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '49/1 24/1 0/1' } })
    .toBuffer();
}
