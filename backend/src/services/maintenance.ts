import type pg from 'pg';
import type { ServerConfig } from '../config.ts';
import { hashPassword } from '../auth/passwords.ts';
import { audit } from './audit.ts';
import { deletePhotoFiles } from './storage.ts';

export const TRASH_DAYS = 30;

// Sherms, die länger als 30 Tage im Papierkorb liegen, endgültig löschen (samt Bildern)
export async function purgeDeleted(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query(`
    DELETE FROM markers WHERE deleted_at < now() - make_interval(days => $1)
    RETURNING id, title, (SELECT array_agg(storage_key) FROM photos p WHERE p.marker_id = markers.id) AS keys`,
    [TRASH_DAYS]);
  for (const row of rows) {
    for (const key of row.keys ?? []) await deletePhotoFiles(key);
    await audit(pool, null, 'purge', row.id, { title: row.title });
  }
  // Abgelaufene Sessions gleich mit aufräumen
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  return rows.length;
}

// Ersten Admin aus ADMIN_USER/ADMIN_PASS anlegen, falls es ihn noch nicht gibt.
// Ändert nie das Passwort eines bestehenden Users.
export async function ensureAdmin(pool: pg.Pool, cfg: ServerConfig): Promise<void> {
  if (!cfg.adminUser || !cfg.adminPass) return;
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE username = $1', [cfg.adminUser]);
  if (rowCount) return;
  if (cfg.adminPass.length < 12) throw new Error('ADMIN_PASS muss mindestens 12 Zeichen haben');
  await pool.query(`INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')`,
    [cfg.adminUser, await hashPassword(cfg.adminPass)]);
  await audit(pool, null, 'user_create', null, { username: cfg.adminUser, role: 'admin', source: 'ADMIN_USER' });
  console.log(`✅ Admin "${cfg.adminUser}" angelegt`);
}
