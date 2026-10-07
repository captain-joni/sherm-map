// Benutzerverwaltung, nur für Admins. Neue User und Resets bekommen ein Einmal-Passwort,
// das beim ersten Login geändert werden muss.
import { Router } from 'express';
import type pg from 'pg';
import { createUserInput, idParam, updateUserInput } from '@sherm/shared';
import { currentUser, destroyAllSessions } from '../../auth/sessions.ts';
import { generateOneTimePassword, hashPassword } from '../../auth/passwords.ts';
import { badRequest, conflict, notFound } from '../../http/errors.ts';
import { body, params } from '../../http/validate.ts';
import { audit } from '../../services/audit.ts';

const USER_COLUMNS = 'id, username, role, must_change_password, disabled_at, last_login_at, created_at';

export function adminUsersRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users ORDER BY username`);
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const admin = currentUser(req);
    const { username, role } = body(req, createUserInput);
    const password = generateOneTimePassword();
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (username, password_hash, role, must_change_password) VALUES ($1, $2, $3, true)
         RETURNING ${USER_COLUMNS}`,
        [username, await hashPassword(password), role]);
      await audit(pool, admin, 'user_create', null, { username, role });
      res.status(201).json({ user: rows[0], one_time_password: password });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('Username ist schon vergeben');
      throw err;
    }
  });

  router.patch('/:id', async (req, res) => {
    const admin = currentUser(req);
    const { id } = params(req, idParam);
    const input = body(req, updateUserInput);
    // Sich selbst aussperren oder herabstufen geht nicht, sonst gibt es am Ende keinen Admin mehr
    if (id === admin.id && (input.disabled || (input.role && input.role !== 'admin'))) {
      throw badRequest('Eigenen Account nicht sperren oder herabstufen');
    }

    const { rows } = await pool.query(`
      UPDATE users SET
        role = coalesce($2, role),
        disabled_at = CASE WHEN $3::boolean IS NULL THEN disabled_at WHEN $3 THEN coalesce(disabled_at, now()) ELSE NULL END
      WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, input.role ?? null, input.disabled ?? null]);
    if (!rows[0]) throw notFound('User nicht gefunden');
    if (input.disabled) await destroyAllSessions(pool, id);
    await audit(pool, admin, 'user_update', null, { username: rows[0].username, ...input });
    res.json(rows[0]);
  });

  router.post('/:id/reset-password', async (req, res) => {
    const admin = currentUser(req);
    const { id } = params(req, idParam);
    const password = generateOneTimePassword();
    const { rows } = await pool.query(
      `UPDATE users SET password_hash = $2, must_change_password = true WHERE id = $1 RETURNING username`,
      [id, await hashPassword(password)]);
    if (!rows[0]) throw notFound('User nicht gefunden');
    await destroyAllSessions(pool, id);
    await audit(pool, admin, 'user_reset_password', null, { username: rows[0].username });
    res.json({ one_time_password: password });
  });

  router.post('/:id/logout-all', async (req, res) => {
    const admin = currentUser(req);
    const { id } = params(req, idParam);
    const { rows } = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('User nicht gefunden');
    await destroyAllSessions(pool, id, id === admin.id ? req.sessionTokenHash : undefined);
    await audit(pool, admin, 'user_logout_all', null, { username: rows[0].username });
    res.json({ success: true });
  });

  return router;
}
