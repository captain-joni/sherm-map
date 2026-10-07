// Startet die App für die E2E-Tests: frische Datenbank, Migrationen, Admin, gebautes Frontend (web/dist).
// Wird von playwright.config.ts als webServer gestartet. Braucht E2E_DATABASE_URL (Postgres mit PostGIS).
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

const adminUrl = process.env.E2E_DATABASE_URL ?? 'postgres://postgres:t@127.0.0.1:55432/postgres';
const dbName = 'sherm_e2e';
const dbUrl = Object.assign(new URL(adminUrl), { pathname: `/${dbName}` }).toString();

const admin = new pg.Pool({ connectionString: adminUrl });
await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();

process.env.DATABASE_URL = dbUrl;
process.env.UPLOADS_DIR = await mkdtemp(path.join(os.tmpdir(), 'sherm-e2e-uploads-'));

const { loadServerConfig } = await import('../backend/src/config.ts');
const { pool } = await import('../backend/src/db/pool.ts');
const { migrate } = await import('../backend/src/db/migrate.ts');
const { ensureAdmin } = await import('../backend/src/services/maintenance.ts');
const { createApp } = await import('../backend/src/app.ts');

const cfg = loadServerConfig({
  ...process.env,
  NODE_ENV: 'test',
  PORT: '3990',
  PUBLIC_URL: 'http://localhost:3990',
  HASH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
  ADMIN_USER: 'admin',
  ADMIN_PASS: 'e2e-password-123',
});
await migrate(pool, () => {});
await ensureAdmin(pool, cfg);
createApp({
  pool, cfg, rateLimitScale: 100,
  geocode: async () => [{ name: 'Heidelberg', detail: 'Deutschland', lat: 49.41, lng: 8.69 }],
}).listen(cfg.port, () => console.log(`E2E-Server auf ${cfg.publicUrl}`));
