import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });

const env = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL fehlt'),
  UPLOADS_DIR: z.string().default(path.join(REPO_ROOT, 'uploads')),
}).parse(process.env);

export const config = {
  databaseUrl: env.DATABASE_URL,
  uploadsDir: path.resolve(env.UPLOADS_DIR),
  migrationsDir: path.join(REPO_ROOT, 'db', 'migrations'),
};

// Einstellungen, die nur der Server braucht (die Skripte kommen ohne aus)
const serverEnv = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(3000),
  PUBLIC_URL: z.url().default('http://localhost:3000'),     // für Origin-Prüfung und Links
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),   // Anzahl Proxies davor (Traefik = 1)
  HASH_SECRET: z.string().min(32, 'HASH_SECRET muss mindestens 32 Zeichen haben (openssl rand -hex 32)'),
  ADMIN_USER: z.string().optional(),
  ADMIN_PASS: z.string().optional(),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  WEB_DIST: z.string().default(path.join(REPO_ROOT, 'web', 'dist')),
  BACKUP_DIR: z.string().default(path.join(REPO_ROOT, 'backups')),
  GEOCODER_URL: z.url().default('https://photon.komoot.io/api/'),
});

export type ServerConfig = ReturnType<typeof loadServerConfig>;

export function loadServerConfig(source: NodeJS.ProcessEnv = process.env) {
  const e = serverEnv.parse(source);
  const production = e.NODE_ENV === 'production';
  return {
    production,
    port: e.PORT,
    publicUrl: e.PUBLIC_URL.replace(/\/$/, ''),
    trustProxy: e.TRUST_PROXY,
    hashSecret: e.HASH_SECRET,
    adminUser: e.ADMIN_USER || null,
    adminPass: e.ADMIN_PASS || null,
    cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : production,
    webDist: path.resolve(e.WEB_DIST),
    backupDir: path.resolve(e.BACKUP_DIR),
    geocoderUrl: e.GEOCODER_URL,
    sessionIdleDays: 7,
    sessionMaxDays: 30,
  };
}
