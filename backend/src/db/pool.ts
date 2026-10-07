import pg from 'pg';
import { config } from '../config.ts';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

// Fehler auf Idle-Verbindungen (z.B. DB-Neustart) sonst crashen den Prozess
pool.on('error', err => console.error('DB Pool Fehler:', err));
