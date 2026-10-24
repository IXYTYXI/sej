import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAuthConfig } from '../lib/auth-config.ts';
import { hashPassword } from '../lib/auth-password.ts';

test('unavailable registration configuration only closes registration', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'wordsteps-registration-config-'));
  const original = { ...process.env };
  const password = 'owner-password-for-config-tests';
  const hashFile = join(directory, 'password-hash');
  const inviteFile = join(directory, 'invite-code');
  writeFileSync(hashFile, await hashPassword(password));
  writeFileSync(inviteFile, 'valid-test-invite');
  Object.assign(process.env, {
    DATABASE_PATH: join(directory, 'db.sqlite'),
    AUTH_USERNAME: 'yc', AUTH_PASSWORD_HASH_FILE: hashFile,
    NODE_ENV: 'production', APP_ORIGIN: 'https://xairlab.com', NEXT_PUBLIC_BASE_PATH: '/study',
  });
  delete process.env.AUTH_PASSWORD_HASH;
  const health = await import('../app/api/health/route.ts');
  const login = await import('../app/api/auth/login/route.ts');
  const register = await import('../app/api/auth/register/route.ts');
  const request = (path, body) => new Request(`http://localhost:3000/study/api/auth/${path}`, {
    method: 'POST', headers: { origin: 'https://xairlab.com', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    for (const [name, settings] of [
      ['absent', {}],
      ['missing file', { REGISTRATION_CODE_FILE: join(directory, 'missing-invite-code') }],
      ['unreadable file', { REGISTRATION_CODE_FILE: directory }],
      ['too short', { REGISTRATION_CODE: 'short' }],
      ['too long', { REGISTRATION_CODE: 'x'.repeat(129) }],
      ['multiple lines', { REGISTRATION_CODE: 'first-line\nsecond-line' }],
      ['conflicting sources', { REGISTRATION_CODE: 'direct-test-invite', REGISTRATION_CODE_FILE: inviteFile }],
    ]) {
      await t.test(name, async () => {
        delete process.env.REGISTRATION_CODE;
        delete process.env.REGISTRATION_CODE_FILE;
        Object.assign(process.env, settings);
        const healthResponse = await health.GET();
        assert.equal(healthResponse.status, 200);
        const loginResponse = await login.POST(request('login', { username: 'yc', password }));
        assert.equal(loginResponse.status, 200);
        assert.equal((await loginResponse.json()).user.userId, 'owner');
        const registration = await register.POST(request('register', {
          username: 'friend', password: 'friend-password-for-config-tests', inviteCode: 'valid-test-invite',
        }));
        assert.equal(registration.status, 503);
        assert.deepEqual(await registration.json(), { error: '注册尚未开放' });
        assert.equal(await globalThis.wordstepsDatabase.prepare("SELECT id FROM users WHERE username='friend'").first(), null);
      });
    }
  } finally {
    globalThis.wordstepsDatabase?.close(); delete globalThis.wordstepsDatabase;
    for (const name of Object.keys(process.env)) if (!(name in original)) delete process.env[name];
    Object.assign(process.env, original);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('valid registration secrets load while owner password configuration stays mandatory', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wordsteps-required-auth-'));
  const passwordHash = await hashPassword('owner-password-for-config-tests');
  const inviteFile = join(directory, 'invite-code');
  const hashFile = join(directory, 'password-hash');
  writeFileSync(inviteFile, 'valid-test-invite\n');
  writeFileSync(hashFile, passwordHash);
  try {
    assert.equal(getAuthConfig({ AUTH_PASSWORD_HASH: passwordHash, REGISTRATION_CODE: 'valid-test-invite' }).registrationCode, 'valid-test-invite');
    assert.equal(getAuthConfig({ AUTH_PASSWORD_HASH_FILE: hashFile, REGISTRATION_CODE_FILE: inviteFile }).registrationCode, 'valid-test-invite');
    for (const settings of [
      {},
      { AUTH_PASSWORD_HASH: 'not-a-hash' },
      { AUTH_PASSWORD_HASH_FILE: join(directory, 'missing-password-hash') },
      { AUTH_PASSWORD_HASH: passwordHash, AUTH_PASSWORD_HASH_FILE: hashFile },
    ]) assert.throws(() => getAuthConfig({ ...settings, REGISTRATION_CODE: 'valid-test-invite' }), { status: 503 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
