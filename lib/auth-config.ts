import { readFileSync } from 'node:fs';
import type { AuthConfig } from './auth-core';
import { isPasswordHash } from './auth-password';
import { ApiError } from './server-http';

function secretFile(environment: Record<string, string | undefined>, directName: string, fileName: string, missing: string, conflict: string): string {
  let value = environment[directName]?.trim() || '';
  const file = environment[fileName];
  if (file) {
    if (value) throw new ApiError(503, conflict);
    try { value = readFileSync(file, 'utf8').trim(); }
    catch { throw new ApiError(503, missing); }
  }
  return value;
}

function registrationCode(environment: Record<string, string | undefined>): string {
  try {
    const value = secretFile(environment, 'REGISTRATION_CODE', 'REGISTRATION_CODE_FILE', '注册尚未开放', '注册配置冲突');
    return value.length >= 8 && value.length <= 128 && !/[\r\n]/.test(value) ? value : '';
  } catch (error) {
    // Registration is optional; an unusable secret must not disable existing accounts.
    if (error instanceof ApiError) return '';
    throw error;
  }
}

export function getAuthConfig(environment: Record<string, string | undefined> = process.env): AuthConfig {
  const username = environment.AUTH_USERNAME || 'yc';
  const passwordHash = secretFile(environment, 'AUTH_PASSWORD_HASH', 'AUTH_PASSWORD_HASH_FILE', '账号认证尚未配置', '账号认证配置冲突');
  if (!username.trim() || username.length > 128 || !isPasswordHash(passwordHash)) throw new ApiError(503, '账号认证尚未配置');
  return { username, passwordHash, registrationCode: registrationCode(environment) };
}
