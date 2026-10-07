import { Router } from 'express';
import type pg from 'pg';
import { changePasswordInput, loginInput } from '@sherm/shared';
import type { ServerConfig } from '../config.ts';
import { createSession, currentUser, destroyAllSessions, destroySession } from '../auth/sessions.ts';
import { hashPassword, verifyPassword } from '../auth/passwords.ts';
import { HttpError, unauthorized } from '../http/errors.ts';
import type { createRateLimits } from '../http/rate-limits.ts';
import { body } from '../http/validate.ts';
import { audit } from '../services/audit.ts';

export function authRouter(pool: pg.Pool, cfg: ServerConfig, limits: ReturnType<typeof createRateLimits>): Router {
  const router = Router();

  router.post('/login', limits.login, async (req, res) => {
    const { username, password } = body(req, loginInput);
    const { rows } = await pool.query(
      'SELECT id, username, role, password_hash, must_change_password, disabled_at FROM users WHERE username = $1',
      [username]
    );
    const user = rows[0];
    const ok = await verifyPassword(password, user?.password_hash);
    // Immer dieselbe Meldung: nicht verraten, ob es den User gibt oder er gesperrt ist
    if (!user || !ok || user.disabled_at) throw new HttpError(401, 'Login fehlgeschlagen');

    await createSession(pool, cfg, res, req, user.id);
    await audit(pool, { id: user.id, username: user.username, role: user.role, must_change_password: false }, 'login');
    res.json({ id: user.id, username: user.username, role: user.role, must_change_password: user.must_change_password });
  });

  router.post('/logout', async (req, res) => {
    await destroySession(pool, cfg, req, res);
    res.json({ success: true });
  });

  router.get('/me', (req, res) => {
    if (!req.user) throw unauthorized();
    res.json(req.user);
  });

  // Auch mit must_change_password erlaubt, genau dafür ist es da
  router.post('/password', limits.login, async (req, res) => {
    const user = currentUser(req);
    const { current_password, new_password } = body(req, changePasswordInput);
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!(await verifyPassword(current_password, rows[0]?.password_hash))) {
      throw new HttpError(400, 'Aktuelles Passwort stimmt nicht');
    }
    if (current_password === new_password) throw new HttpError(400, 'Neues Passwort muss sich unterscheiden');

    await pool.query('UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1',
      [user.id, await hashPassword(new_password)]);
    // Alle anderen Sitzungen dieses Users beenden
    await destroyAllSessions(pool, user.id, req.sessionTokenHash);
    await audit(pool, user, 'password_change');
    res.json({ ...user, must_change_password: false });
  });

  return router;
}
