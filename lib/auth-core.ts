import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from './database';
import { ApiError, object } from './server-http';
import { verifyPassword } from './auth-password';

export type AuthUser = { userId: string; displayName: string };
export type AuthConfig = { username: string; passwordHash: string };
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

export function createAuthService(db: Database, config: AuthConfig, clock = Date.now) {
  const authVersion = digest(`${config.username}\0${config.passwordHash}`);
  const user: AuthUser = { userId: 'owner', displayName: config.username };
  return {
    async login(input: unknown) {
      const { username, password } = object(input, ['username', 'password']);
      if (typeof username !== 'string' || username.length < 1 || username.length > 128 || typeof password !== 'string' || password.length < 1 || password.length > 1024) throw new ApiError(400, '请输入账号和密码');
      const now = clock();
      const limit = await db.prepare(`INSERT INTO auth_login_limits(key,attempts,window_start) VALUES ('login',1,?)
        ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<=? THEN 1 ELSE attempts+1 END,
        window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END RETURNING attempts`)
        .bind(now, now - LOGIN_WINDOW, now - LOGIN_WINDOW).first<{ attempts: number }>();
      if (!limit || limit.attempts > 10) throw new ApiError(429, '登录尝试过多，请在 15 分钟后重试');
      const correctPassword = await verifyPassword(password, config.passwordHash);
      const correctUser = timingSafeEqual(Buffer.from(digest(username)), Buffer.from(digest(config.username)));
      if (!correctPassword || !correctUser) throw new ApiError(401, '账号或密码不正确');
      const token = randomBytes(32).toString('base64url');
      const expiresAt = now + SESSION_DURATION;
      await db.batch([
        db.prepare('DELETE FROM auth_sessions WHERE expires_at<=? OR auth_version<>?').bind(now, authVersion),
        db.prepare('INSERT INTO auth_sessions(token_hash,auth_version,expires_at,created_at) VALUES (?,?,?,?)').bind(digest(token), authVersion, expiresAt, now),
        db.prepare("DELETE FROM auth_login_limits WHERE key='login'"),
      ]);
      return { token, expiresAt, user };
    },
    async userForHeaders(headers: Headers): Promise<AuthUser | null> {
      const token = tokenFromHeaders(headers);
      if (!token) return null;
      const row = await db.prepare('SELECT token_hash FROM auth_sessions WHERE token_hash=? AND auth_version=? AND expires_at>?').bind(digest(token), authVersion, clock()).first();
      return row ? user : null;
    },
    async logout(headers: Headers): Promise<void> {
      const token = tokenFromHeaders(headers);
      if (token) await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(digest(token)).run();
    },
  };
}
