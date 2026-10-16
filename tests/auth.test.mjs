import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readBody } from '../lib/server-http.ts';

test('configured external origin allows reverse-proxied JSON but ignores spoofed forwarded hosts', async () => {
  const old = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://xairlab.com';
  try {
    const request = (origin) => new Request('http://localhost:3000/study/api/settings', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-forwarded-host': 'evil.example' }, body: '{}' });
    assert.deepEqual(await readBody(request('https://xairlab.com')), {});
    await assert.rejects(readBody(request('https://evil.example')), { status: 403 });
  } finally { if (old === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = old; }
});

test('password hashing verifies the right password and rejects malformed or wrong hashes', async () => {
  const { hashPassword, verifyPassword } = await import('../lib/auth-password.ts');
  const hash = await hashPassword('test-password-not-for-production');
  assert.equal(await verifyPassword('test-password-not-for-production', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
  assert.equal(await verifyPassword('test-password-not-for-production', 'scrypt$999999999$8$1$x$x'), false);
});

test('sessions store only token hashes, expire, revoke, and reject forged OAI headers', async () => {
  const { openDatabase } = await import('../db/sqlite.ts');
  const { createAuthService, SESSION_COOKIE, sessionCookie } = await import('../lib/auth-core.ts');
  const { hashPassword } = await import('../lib/auth-password.ts');
  const db = openDatabase(':memory:');
  let now = 1_800_000_000_000;
  const config = { username: 'yc', passwordHash: await hashPassword('test-password-not-for-production'), registrationCode: 'invite-code-for-tests' };
  const auth = createAuthService(db, config, () => now);
  try {
    const session = await auth.login({ username: 'yc', password: 'test-password-not-for-production' });
    assert.equal(session.user.userId, 'owner');
    const row = await db.prepare('SELECT token_hash FROM auth_sessions').first();
    assert.notEqual(row.token_hash, session.token);
    assert.match(row.token_hash, /^[a-f0-9]{64}$/);
    const headers = new Headers({ cookie: `${SESSION_COOKIE}=${session.token}` });
    assert.equal((await auth.userForHeaders(headers)).displayName, 'yc');
    assert.equal(await auth.userForHeaders(new Headers({ 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'evil@example.test' })), null);
    const cookie = sessionCookie(session.token, session.expiresAt, { production: true, path: '/study', now });
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Secure/); assert.match(cookie, /Path=\/study(?:;|$)/);
    now = session.expiresAt;
    assert.equal(await auth.userForHeaders(headers), null);
    now -= 1000;
    const second = await auth.login({ username: 'yc', password: 'test-password-not-for-production' });
    const secondHeaders = new Headers({ cookie: `${SESSION_COOKIE}=${second.token}` });
    await auth.logout(secondHeaders);
    assert.equal(await auth.userForHeaders(secondHeaders), null);
  } finally { db.close(); }
});

test('registration needs the invite code and keeps a separate user and AI identity', async () => {
  const { openDatabase } = await import('../db/sqlite.ts');
  const { createAuthService, SESSION_COOKIE } = await import('../lib/auth-core.ts');
  const { hashPassword } = await import('../lib/auth-password.ts');
  const db = openDatabase(':memory:');
  const config = { username: 'yc', passwordHash: await hashPassword('test-password-not-for-production'), registrationCode: 'invite-code-for-tests' };
  const auth = createAuthService(db, config);
  try {
    await assert.rejects(auth.register({ username: 'friend', password: 'another-password-ok', inviteCode: 'wrong-invite-code' }), { status: 403 });
    const session = await auth.register({ username: 'friend', password: 'another-password-ok', inviteCode: 'invite-code-for-tests' });
    assert.notEqual(session.user.userId, 'owner');
    assert.equal(session.user.displayName, 'friend');
    assert.equal((await auth.userForHeaders(new Headers({ cookie: `${SESSION_COOKIE}=${session.token}` }))).userId, session.user.userId);
    await assert.rejects(auth.register({ username: 'Friend', password: 'another-password-ok', inviteCode: 'invite-code-for-tests' }), { status: 409 });
    const owner = await auth.login({ username: 'yc', password: 'test-password-not-for-production' });
    assert.equal(owner.user.userId, 'owner');
  } finally { db.close(); }
});

test('auth configuration accepts a mounted hash file, defaults to yc and fails closed without a valid hash', async () => {
  const { getAuthConfig } = await import('../lib/auth-config.ts');
  const { hashPassword } = await import('../lib/auth-password.ts');
  const directory = mkdtempSync(join(tmpdir(), 'wordsteps-auth-'));
  try {
    const passwordHash = await hashPassword('test-password-not-for-production');
    const path = join(directory, 'password-hash');
    writeFileSync(path, passwordHash + '\n', { mode: 0o600 });
    assert.deepEqual(getAuthConfig({ AUTH_PASSWORD_HASH_FILE: path }), { username: 'yc', passwordHash, registrationCode: '' });
    assert.throws(() => getAuthConfig({}), { status: 503 });
    assert.throws(() => getAuthConfig({ AUTH_PASSWORD_HASH: 'plaintext' }), { status: 503 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a valid session remains usable after reopening the persistent database', async () => {
  const { openDatabase } = await import('../db/sqlite.ts');
  const { createAuthService, SESSION_COOKIE } = await import('../lib/auth-core.ts');
  const { hashPassword } = await import('../lib/auth-password.ts');
  const directory = mkdtempSync(join(tmpdir(), 'wordsteps-auth-persist-'));
  const path = join(directory, 'sessions.sqlite');
  const config = { username: 'yc', passwordHash: await hashPassword('test-password-not-for-production') };
  let db = openDatabase(path);
  try {
    const session = await createAuthService(db, config).login({ username: 'yc', password: 'test-password-not-for-production' });
    db.close(); db = openDatabase(path);
    assert.equal((await createAuthService(db, config).userForHeaders(new Headers({ cookie: `${SESSION_COOKIE}=${session.token}` }))).userId, 'owner');
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('login is limited before password work and password rotation invalidates prior sessions', async () => {
  const { openDatabase } = await import('../db/sqlite.ts');
  const { createAuthService, SESSION_COOKIE } = await import('../lib/auth-core.ts');
  const { hashPassword } = await import('../lib/auth-password.ts');
  const db = openDatabase(':memory:');
  const config = { username: 'yc', passwordHash: await hashPassword('test-password-not-for-production') };
  const auth = createAuthService(db, config);
  try {
    const session = await auth.login({ username: 'yc', password: 'test-password-not-for-production' });
    const rotated = createAuthService(db, { ...config, passwordHash: await hashPassword('another-password-for-tests') });
    assert.equal(await rotated.userForHeaders(new Headers({ cookie: `${SESSION_COOKIE}=${session.token}` })), null);
    for (let i = 0; i < 10; i++) await assert.rejects(auth.login({ username: 'yc', password: 'wrong' }), { status: 401 });
    await assert.rejects(auth.login({ username: 'yc', password: 'test-password-not-for-production' }), { status: 429 });
  } finally { db.close(); }
});
