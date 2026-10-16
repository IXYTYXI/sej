import { getDatabase } from '../db/sqlite';
import { getAuthConfig } from './auth-config';
import { createAuthService, SESSION_COOKIE, sessionCookie, type AuthUser } from './auth-core';
import { appPath } from './paths';

export function getAuthService() { return createAuthService(getDatabase(), getAuthConfig()); }

export async function getUserForHeaders(headers: Headers): Promise<AuthUser | null> {
  if (!headers.get('cookie')?.includes(`${SESSION_COOKIE}=`)) return null;
  return getAuthService().userForHeaders(headers);
}

export function getRequestUser(request: Request): Promise<AuthUser | null> { return getUserForHeaders(request.headers); }

export function authenticationCookie(token: string, expiresAt: number): string {
  return sessionCookie(token, expiresAt, { production: process.env.NODE_ENV === 'production', path: appPath('/').replace(/\/$/, '') || '/' });
}
