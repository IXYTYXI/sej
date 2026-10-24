import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/sqlite.ts';
import { createAuthService } from '../lib/auth-core.ts';
import { hashPassword } from '../lib/auth-password.ts';

const password = 'owner-password-for-tests';
const friendPassword = 'friend-password-for-tests';
const inviteCode = 'invite-code-for-tests';
const passwordHash = await hashPassword(password);

function fixture(t, username = 'yc') {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  let now = 1_800_000_000_000;
  const auth = createAuthService(db, { username, passwordHash, registrationCode: inviteCode }, () => now);
  return { auth, db, advance: milliseconds => { now += milliseconds; } };
}

test('unknown usernames share a bounded limit that existing accounts cannot clear', async t => {
  const { auth, db, advance } = fixture(t);
  for (let i = 0; i < 10; i++) await assert.rejects(auth.login({ username: `unknown-${i}`, password: 'wrong' }), { status: 401 });
  await assert.rejects(auth.login({ username: 'another-unknown', password: 'wrong' }), { status: 429 });
  assert.equal((await auth.login({ username: 'yc', password })).user.userId, 'owner');
  await auth.register({ username: 'friend', password: friendPassword, inviteCode });
  await assert.rejects(auth.login({ username: 'still-unknown', password: 'wrong' }), { status: 429 });
  advance(15 * 60_000);
  await assert.rejects(auth.login({ username: 'new-unknown', password: 'wrong' }), { status: 401 });
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM auth_login_limits WHERE key LIKE 'login:%'").first()).count, 1);
});

test('successful logins to another account cannot clear a target account limit, including ASCII case variants', async t => {
  const { auth } = fixture(t);
  await auth.register({ username: 'friend', password: friendPassword, inviteCode });
  for (let i = 0; i < 10; i++) {
    await assert.rejects(auth.login({ username: i % 2 ? 'YC' : 'yc', password: 'wrong' }), { status: 401 });
    assert.equal((await auth.login({ username: 'FRIEND', password: friendPassword })).user.displayName, 'friend');
  }
  await assert.rejects(auth.login({ username: 'yC', password: 'wrong' }), { status: 429 });
  assert.equal((await auth.login({ username: 'friend', password: friendPassword })).user.displayName, 'friend');
});

test('a successful registration cannot clear another account login limit', async t => {
  const { auth } = fixture(t);
  for (let i = 0; i < 10; i++) await assert.rejects(auth.login({ username: 'yc', password: 'wrong' }), { status: 401 });
  await auth.register({ username: 'friend', password: friendPassword, inviteCode });
  await assert.rejects(auth.login({ username: 'yc', password }), { status: 429 });
});

test('successful login and registration do not clear the shared registration limit', async t => {
  const { auth } = fixture(t);
  for (let i = 0; i < 8; i++) await assert.rejects(auth.register({ username: 'friend', password: friendPassword, inviteCode: 'wrong' }), { status: 403 });
  await auth.register({ username: 'friend', password: friendPassword, inviteCode });
  await auth.login({ username: 'yc', password });
  await assert.rejects(auth.register({ username: 'another', password: friendPassword, inviteCode: 'wrong' }), { status: 403 });
  await assert.rejects(auth.register({ username: 'another', password: friendPassword, inviteCode: 'wrong' }), { status: 429 });
});

test('successful login resets its own attempts and a locked account recovers after the window', async t => {
  const { auth, advance } = fixture(t);
  for (let i = 0; i < 9; i++) await assert.rejects(auth.login({ username: 'yc', password: 'wrong' }), { status: 401 });
  assert.equal((await auth.login({ username: 'YC', password })).user.userId, 'owner');
  for (let i = 0; i < 10; i++) await assert.rejects(auth.login({ username: 'yc', password: 'wrong' }), { status: 401 });
  await assert.rejects(auth.login({ username: 'yc', password }), { status: 429 });
  advance(15 * 60_000);
  assert.equal((await auth.login({ username: 'yc', password })).user.userId, 'owner');
});

test('concurrent attempts share the same account limit', async t => {
  const { auth } = fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 11 }, (_, index) => auth.login({ username: index % 2 ? 'YC' : 'yc', password: 'wrong' })));
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 401).length, 10);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 429).length, 1);
});

test('legacy owner names remain usable without relaxing new registration names', async t => {
  for (const username of ['x', 'owner@example.invalid', '账号', 'a'.repeat(33), 'a'.repeat(128)]) {
    const { auth } = fixture(t, username);
    assert.deepEqual((await auth.login({ username, password })).user, { userId: 'owner', displayName: username, role: 'admin' });
    await assert.rejects(auth.register({ username, password: friendPassword, inviteCode }), { status: 400 });
  }
  const { auth } = fixture(t);
  await assert.rejects(auth.login({ username: '', password }), { status: 400 });
  await assert.rejects(auth.login({ username: 'a'.repeat(129), password }), { status: 400 });
});

test('non-ASCII case variants remain distinct as in SQLite NOCASE', async t => {
  const { auth } = fixture(t, 'Ä');
  for (let i = 0; i < 10; i++) await assert.rejects(auth.login({ username: 'ä', password }), { status: 401 });
  assert.equal((await auth.login({ username: 'Ä', password })).user.userId, 'owner');
});
