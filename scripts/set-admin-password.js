// Setzt das Passwort von ADMIN_USER auf ADMIN_PASS (legt den User an, falls er fehlt).
// Im Container: docker compose exec backend node scripts/set-admin-password.js
// Lokal:        node scripts/set-admin-password.js   (liest .env)
require('dotenv').config({ quiet: true });
const bcrypt = require('bcrypt');
const pool = require('../db');

async function main() {
  const username = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASS;
  if (!username || !password) throw new Error('ADMIN_USER und ADMIN_PASS müssen gesetzt sein');
  if (password.length < 12) throw new Error('ADMIN_PASS muss mindestens 12 Zeichen haben');

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [username, hash]
  );
  console.log(`✅ Passwort für "${username}" gesetzt`);
}

main()
  .catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
