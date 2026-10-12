import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from './database';
import { ApiError, object } from './server-http';
import { hashPassword, verifyPassword } from './auth-password';

export type AuthUser = { userId: string; displayName: string };
export type AuthConfig = { username: string; passwordHash: string; registrationCode: string };
export const SESSION_COOKIE = 'wordsteps_session';
const SESSION_DURATION = 7 * 86400000;
const LOGIN_WINDOW = 15 * 60000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function tokenFromHeaders(headers: Headers): string | null {
  const value = headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function sessionCookie(token: string, expiresAt: number, options: { production?: boolean; path?: string; now?: number } = {}): string {
  const path = options.path || '/';
  if (!/^\/[A-Za-z0-9/_-]*$/.test(path)) throw new Error('Invalid session cookie path');
  const maxAge = Math.max(0, Math.floor((expiresAt - (options.now ?? Date.now())) / 1000));
  return `${SESSION_COOKIE}=${token}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Expires=${new Date(expiresAt).toUTCString()}${options.production ? '; Secure' : ''}`;
}

const USERNAME = /^[A-Za-z0-9_-]{2,32}$/;

function sameSecret(input: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(digest(input)), Buffer.from(digest(expected)));
}

export function createAuthService(db: Database, config: AuthConfig, clock = Date.now) {
  const ensureOwner = () => db.prepare(`INSERT INTO users(id,username,password_hash,created_at) VALUES ('owner',?,?,?)
    ON CONFLICT(id) DO UPDATE SET username=excluded.username, password_hash=excluded.password_hash`)
    .bind(config.username, config.passwordHash, clock()).run();

  async function limit(key: string, now: number) {
    const row = await db.prepare(`INSERT INTO auth_login_limits(key,attempts,window_start) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<=? THEN 1 ELSE attempts+1 END,
      window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END RETURNING attempts`)
      .bind(key, now, now - LOGIN_WINDOW, now - LOGIN_WINDOW).first<{ attempts: number }>();
    if (!row || row.attempts > 10) throw new ApiError(429, '尝试过多，请在 15 分钟后重试');
  }

  async function account(username: string) {
    return db.prepare('SELECT id,username,password_hash FROM users WHERE username=? COLLATE NOCASE').bind(username).first<{ id: string; username: string; password_hash: string }>();
  }

  async function openSession(userId: string, passwordHash: string, now: number, loginLimitKey?: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + SESSION_DURATION;
    const version = digest(passwordHash);
    await db.batch([
      db.prepare('DELETE FROM auth_sessions WHERE expires_at<=? OR (user_id=? AND auth_version<>?)').bind(now, userId, version),
      db.prepare('INSERT INTO auth_sessions(token_hash,auth_version,user_id,expires_at,created_at) VALUES (?,?,?,?,?)').bind(digest(token), version, userId, expiresAt, now),
      ...(loginLimitKey ? [db.prepare('DELETE FROM auth_login_limits WHERE key=?').bind(loginLimitKey)] : []),
    ]);
    return { token, expiresAt };
  }

  return {
    async login(input: unknown) {
      const { username, password } = object(input, ['username', 'password']);
      if (typeof username !== 'string' || username.length < 1 || username.length > 128 || typeof password !== 'string' || password.length < 1 || password.length > 1024) throw new ApiError(400, '请输入账号和密码');
      const now = clock();
      await ensureOwner();
      const row = await account(username);
      // Use the matched identity so the limiter follows SQLite's NOCASE semantics.
      const loginLimitKey = row ? `login:user:${row.id}` : 'login:missing';
      await limit(loginLimitKey, now);
      if (!row || !await verifyPassword(password, row.password_hash)) throw new ApiError(401, '账号或密码不正确');
      const session = await openSession(row.id, row.password_hash, now, loginLimitKey);
      return { ...session, user: { userId: row.id, displayName: row.username } };
    },
    async register(input: unknown) {
      const { username, password, inviteCode } = object(input, ['username', 'password', 'inviteCode']);
      if (!config.registrationCode) throw new ApiError(503, '注册尚未开放');
      if (typeof username !== 'string' || !USERNAME.test(username) || typeof password !== 'string' || typeof inviteCode !== 'string' || inviteCode.length > 128) throw new ApiError(400, '请填写账号、至少 12 位密码和邀请码');
      const now = clock();
      await limit('register', now);
      if (!sameSecret(inviteCode, config.registrationCode)) throw new ApiError(403, '邀请码不正确');
      await ensureOwner();
      if ((await account(username)) || username.toLowerCase() === config.username.toLowerCase()) throw new ApiError(409, '这个账号已经注册');
      let passwordHash: string;
      try { passwordHash = await hashPassword(password); }
      catch { throw new ApiError(400, '密码需要 12 到 1024 个字符'); }
      const userId = randomBytes(16).toString('base64url');
      try {
        await db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)').bind(userId, username, passwordHash, now).run();
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE')) throw new ApiError(409, '这个账号已经注册');
        throw error;
      }
      const session = await openSession(userId, passwordHash, now);
      return { ...session, user: { userId, displayName: username } };
    },
    async userForHeaders(headers: Headers): Promise<AuthUser | null> {
      const token = tokenFromHeaders(headers);
      if (!token) return null;
      await ensureOwner();
      const row = await db.prepare(`SELECT u.id AS user_id, u.username, u.password_hash, s.auth_version FROM auth_sessions s
        JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(digest(token), clock()).first<{ user_id: string; username: string; password_hash: string; auth_version: string }>();
      if (!row || row.auth_version !== digest(row.password_hash)) return null;
      return { userId: row.user_id, displayName: row.username };
    },
    async logout(headers: Headers): Promise<void> {
      const token = tokenFromHeaders(headers);
      if (token) await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(digest(token)).run();
    },
  };
}
