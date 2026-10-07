const { Pool } = require('pg');
require('dotenv').config({ quiet: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Fehler auf Idle-Verbindungen (z.B. DB-Neustart) sonst crashen den Prozess
pool.on('error', err => console.error('DB Pool Fehler:', err));

pool.query('SELECT 1')
  .then(() => console.log('✅ DB verbunden'))
  .catch(err => console.error('DB Verbindung fehlgeschlagen:', err));

module.exports = pool;
