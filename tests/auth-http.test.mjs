import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('production auth routes set a scoped secure session and logout revokes it without trusting OAI headers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wordsteps-auth-http-'));
  const { hashPassword } = await import('../lib/auth-password.ts');
  const original = { ...process.env };
  Object.assign(process.env, { DATABASE_PATH: join(directory, 'db.sqlite'), AUTH_USERNAME: 'yc', AUTH_PASSWORD_HASH: await hashPassword('test-password-not-for-production'), NODE_ENV: 'production', APP_ORIGIN: 'https://xairlab.com', NEXT_PUBLIC_BASE_PATH: '/study' });
  delete process.env.AUTH_PASSWORD_HASH_FILE;
  try {
    const login = await import('../app/api/auth/login/route.ts');
    const logout = await import('../app/api/auth/logout/route.ts');
    const health = await import('../app/api/health/route.ts');
    const { getRequestUser } = await import('../lib/auth.ts');
    const request = (path, body, headers = {}) => new Request(`http://localhost:3000/study/api/auth/${path}`, { method: 'POST', headers: { origin: 'https://xairlab.com', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await health.GET()).status, 200);
    assert.equal(await getRequestUser(new Request('https://xairlab.com/study/api/state', { headers: { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'forged@example.test' } })), null);
    const response = await login.POST(request('login', { username: 'yc', password: 'test-password-not-for-production' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { user: { userId: 'owner', displayName: 'yc', role: 'admin' } });
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /Path=\/study;/); assert.match(setCookie, /Secure/); assert.match(setCookie, /HttpOnly/);
    const cookie = setCookie.split(';')[0];
    const authenticated = new Request('https://xairlab.com/study/api/state', { headers: { cookie } });
    assert.equal((await getRequestUser(authenticated)).userId, 'owner');
    assert.equal((await logout.POST(request('logout', {}, { cookie, origin: 'https://evil.example' }))).status, 403);
    assert.equal((await getRequestUser(authenticated)).userId, 'owner');
    const loggedOut = await logout.POST(request('logout', {}, { cookie }));
    assert.equal(loggedOut.status, 200); assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal(await getRequestUser(authenticated), null);
    assert.equal(logout.GET, undefined);
  } finally {
    globalThis.wordstepsDatabase?.close(); delete globalThis.wordstepsDatabase;
    for (const name of Object.keys(process.env)) if (!(name in original)) delete process.env[name];
    Object.assign(process.env, original);
    rmSync(directory, { recursive: true, force: true });
  }
});
