import type pg from 'pg';
import type { SessionUser } from '@sherm/shared';

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

// Jede ändernde Admin-Aktion landet hier. username wird als Text mitgespeichert,
// damit der Eintrag lesbar bleibt, auch wenn der User später gelöscht wird.
export async function audit(
  db: Queryable,
  user: SessionUser | null,
  action: string,
  markerId: number | null = null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    'INSERT INTO audit_log (user_id, username, action, marker_id, details) VALUES ($1, $2, $3, $4, $5)',
    [user?.id ?? null, user?.username ?? null, action, markerId, details]
  );
}

// Ändernde Aktionen in einer Transaktion: Daten und Audit-Eintrag gemeinsam oder gar nicht
export async function inTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
