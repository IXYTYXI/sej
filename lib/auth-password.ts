import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const cost = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const derive = (password: string, salt: Buffer): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, cost, (error, key) => error ? reject(error) : resolve(key));
});

export function isPasswordHash(value: string): boolean {
  return /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/.test(value);
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 1024) throw new Error('Password must contain 12–1024 characters');
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (!isPasswordHash(encoded) || password.length > 1024) return false;
  const [, , , , salt, key] = encoded.split('$');
  const actual = await derive(password, Buffer.from(salt, 'base64url'));
  return timingSafeEqual(actual, Buffer.from(key, 'base64url'));
}
