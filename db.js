
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

module.exports = pool;

pool.connect()
  .then(() => console.log('✅ DB verbunden'))
  .catch(err => console.error('DB Verbindung fehlgeschlagen:', err));