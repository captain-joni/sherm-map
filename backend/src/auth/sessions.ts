// Admin-Sessions: zufälliges Token im httpOnly-Cookie, in der DB liegt nur sein sha256-Hash.
// Sessions laufen nach sessionIdleDays ohne Aktivität oder spätestens nach sessionMaxDays ab.
import { createHash, randomBytes } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type pg from 'pg';
import type { SessionUser, UserRole } from '@sherm/shared';
import type { ServerConfig } from '../config.ts';
import { forbidden, unauthorized } from '../http/errors.ts';

export const SESSION_COOKIE = 'sherm_session';
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function createSession(pool: pg.Pool, cfg: ServerConfig, res: Response, req: Request, userId: number) {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4)`,
    [sha256(token), userId, cfg.sessionMaxDays, (req.get('user-agent') ?? '').slice(0, 300)]
  );
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: cfg.sessionMaxDays * 24 * 60 * 60 * 1000,
  });
}

export async function destroySession(pool: pg.Pool, cfg: ServerConfig, req: Request, res: Response) {
  if (req.sessionTokenHash) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [req.sessionTokenHash]);
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: cfg.cookieSecure, sameSite: 'strict', path: '/' });
}

export async function destroyAllSessions(pool: pg.Pool, userId: number, exceptTokenHash?: string) {
  await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash IS DISTINCT FROM $2', [userId, exceptTokenHash ?? null]);
}

// Hängt req.user an, wenn ein gültiges Session-Cookie dabei ist. Lehnt selbst nichts ab.
export function loadSession(pool: pg.Pool, cfg: ServerConfig): RequestHandler {
  return async (req, _res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return next();

    const tokenHash = sha256(token);
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.role, u.must_change_password, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.expires_at > now()
         AND s.last_seen_at > now() - make_interval(days => $2)
         AND u.disabled_at IS NULL`,
      [tokenHash, cfg.sessionIdleDays]
    );
    const row = rows[0];
    if (!row) return next();

    req.user = { id: row.id, username: row.username, role: row.role, must_change_password: row.must_change_password };
    req.sessionTokenHash = tokenHash;
    if (Date.now() - row.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
      await pool.query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [tokenHash]);
    }
    next();
  };
}

const ROLE_RANK: Record<UserRole, number> = { moderator: 1, admin: 2 };

// Eingeloggt und mindestens diese Rolle. Wer sein Einmal-Passwort noch nicht geändert hat, darf nur das.
export function requireRole(role: UserRole): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) return next(unauthorized());
    if (user.must_change_password) return next(forbidden('Bitte zuerst das Passwort ändern'));
    if (ROLE_RANK[user.role] < ROLE_RANK[role]) return next(forbidden());
    next();
  };
}

export function currentUser(req: Request): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
