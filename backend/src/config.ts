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
