// Wendet alle noch fehlenden SQL-Migrationen aus db/migrations/ an.
// Jede Datei läuft in einer eigenen Transaktion. Bereits angewendete Dateien dürfen nicht mehr
// geändert werden (Checksumme), neue Änderungen kommen immer als neue Datei.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { config } from '../config.ts';
import { isMain } from '../util.ts';

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
const LOCK_ID = 727274; // beliebig, verhindert parallele Migrationen (z.B. zwei Container)

export async function migrate(pool: pg.Pool, log: (msg: string) => void = console.log): Promise<string[]> {
  const files = (await readdir(config.migrationsDir)).filter(f => MIGRATION_FILE.test(f)).sort();
  const client = await pool.connect();
  const appliedNow: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations');
    const applied = new Map(rows.map(r => [r.name, r.checksum]));

    for (const name of applied.keys()) {
      if (!files.includes(name)) log(`⚠️  Migration ${name} ist in der DB eingetragen, die Datei fehlt aber`);
    }

    for (const file of files) {
      const sql = await readFile(path.join(config.migrationsDir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');

      if (applied.has(file)) {
        if (applied.get(file) !== checksum) {
          throw new Error(`Migration ${file} wurde nach dem Anwenden geändert. Änderungen gehören in eine neue Migration.`);
        }
        continue;
      }

      log(`→ ${file}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} fehlgeschlagen: ${(err as Error).message}`, { cause: err });
      }
      appliedNow.push(file);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }

  return appliedNow;
}

export async function schemaVersion(pool: pg.Pool): Promise<string | null> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1`
  ).catch(() => ({ rows: [] }));
  return rows[0]?.name ?? null;
}

if (isMain(import.meta.url)) {
  const { pool } = await import('./pool.ts');
  try {
    const applied = await migrate(pool);
    console.log(applied.length ? `✅ ${applied.length} Migration(en) angewendet` : '✅ Schema ist aktuell');
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
