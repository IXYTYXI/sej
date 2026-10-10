import { readFileSync } from 'node:fs';
import type { AuthConfig } from './auth-core';
import { isPasswordHash } from './auth-password';
import { ApiError } from './server-http';

export function getAuthConfig(environment: Record<string, string | undefined> = process.env): AuthConfig {
  const username = environment.AUTH_USERNAME || 'yc';
  let passwordHash = environment.AUTH_PASSWORD_HASH?.trim() || '';
  if (environment.AUTH_PASSWORD_HASH_FILE) {
    if (passwordHash) throw new ApiError(503, '账号认证配置冲突');
    try { passwordHash = readFileSync(environment.AUTH_PASSWORD_HASH_FILE, 'utf8').trim(); }
    catch { throw new ApiError(503, '账号认证尚未配置'); }
  }
  if (!username.trim() || username.length > 128 || !isPasswordHash(passwordHash)) throw new ApiError(503, '账号认证尚未配置');
  return { username, passwordHash };
}
