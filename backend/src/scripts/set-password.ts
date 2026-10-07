// Notfall-Werkzeug: Passwort eines Users setzen bzw. Admin anlegen, z.B. wenn sich niemand mehr anmelden kann.
// Im Container:  docker compose exec backend npm run set-password -w backend -- <username>
// Das Passwort wird abgefragt (oder per Umgebungsvariable NEW_PASSWORD übergeben), nie als Argument.
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { LIMITS } from '@sherm/shared';
import { hashPassword } from '../auth/passwords.ts';
import { destroyAllSessions } from '../auth/sessions.ts';
import { pool } from '../db/pool.ts';
import { audit } from '../services/audit.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { admin: { type: 'boolean', default: false } },
});

async function main() {
  const username = positionals[0];
  if (!username) throw new Error('Nutzung: npm run set-password -w backend -- <username> [--admin]');

  let password = process.env.NEW_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question(`Neues Passwort für ${username}: `);
    rl.close();
  }
  if (password.length < LIMITS.passwordMin) throw new Error(`Passwort muss mindestens ${LIMITS.passwordMin} Zeichen haben`);

  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = false,
       disabled_at = NULL, role = CASE WHEN $4 THEN 'admin'::user_role ELSE users.role END
     RETURNING id, role, (xmax = 0) AS created`,
    [username, await hashPassword(password), values.admin ? 'admin' : 'moderator', values.admin]);
  await destroyAllSessions(pool, rows[0].id);
  await audit(pool, null, rows[0].created ? 'user_create' : 'user_reset_password', null, { username, role: rows[0].role, source: 'cli' });
  console.log(`✅ ${rows[0].created ? 'Angelegt' : 'Passwort gesetzt'}: ${username} (${rows[0].role})`);
}

main()
  .catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
