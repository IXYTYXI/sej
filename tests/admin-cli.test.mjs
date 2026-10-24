import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPassword } from '../lib/auth-password.ts';

const command = fileURLToPath(new URL('../scripts/create-admin.mjs', import.meta.url));
function fixture(withRoles = true) {
  const directory = mkdtempSync(join(tmpdir(), 'wordsteps-admin-cli-'));
  const path = join(directory, 'learning.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL${withRoles ? ", role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin'))" : ''});`);
  const run = (username = 'study-admin', password = 'test-password-for-new-admin', extra = []) => spawnSync(process.execPath, [command, '--username', username, ...extra], {
    input: password + '\n', encoding: 'utf8', env: { ...process.env, DATABASE_PATH: path, AUTH_USERNAME: 'original-owner' },
  });
  return { directory, path, db, run, close() { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('admin CLI creates a separate admin with a verifiable hash and does not disclose credentials', async () => {
  const f = fixture();
  try {
    f.db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('owner', 'original-owner', 'existing-owner-hash', 1, 'admin');
    const before = f.db.prepare('SELECT * FROM users WHERE id=?').get('owner');
    const password = '  admin password with spaces  ';
    const result = f.run('study-admin', password);
    assert.equal(result.status, 0, result.stderr);
    const row = f.db.prepare('SELECT * FROM users WHERE username=?').get('study-admin');
    assert.equal(row.role, 'admin');
    assert.notEqual(row.id, 'owner');
    assert.equal(await verifyPassword(password, row.password_hash), true);
    assert.deepEqual(f.db.prepare('SELECT * FROM users WHERE id=?').get('owner'), before);
    assert.equal(result.stdout.includes(password), false);
    assert.equal(result.stderr.includes(password), false);
    assert.equal(result.stdout.includes(row.password_hash), false);
    assert.equal(result.stderr.includes(row.password_hash), false);
    assert.deepEqual(JSON.parse(result.stdout), { created: true, username: 'study-admin', role: 'admin' });
  } finally { f.close(); }
});

test('admin CLI refuses existing usernames case-insensitively without resetting or promoting them', () => {
  const f = fixture();
  try {
    f.db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('old-user', 'Study-Admin', 'existing-password-hash', 1, 'user');
    const before = f.db.prepare('SELECT * FROM users').all();
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already exists/i);
    assert.deepEqual(f.db.prepare('SELECT * FROM users').all(), before);
  } finally { f.close(); }
});

test('admin CLI rejects reserved usernames, malformed input and command-line password flags', () => {
  const f = fixture();
  try {
    for (const [username, password, extra] of [
      ['ORIGINAL-OWNER', 'valid-test-password', []], ['x', 'valid-test-password', []],
      ['study admin', 'valid-test-password', []], ['study-admin', 'short', []],
      ['study-admin', 'x'.repeat(1025), []], ['study-admin', 'valid-test-password', ['--password', 'never-print-this-secret']],
    ]) {
      const result = f.run(username, password, extra);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout.includes('never-print-this-secret'), false);
      assert.equal(result.stderr.includes('never-print-this-secret'), false);
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  } finally { f.close(); }
});

test('admin CLI requires an existing upgraded database and never creates a new database implicitly', () => {
  const f = fixture(false);
  try {
    const outdated = f.run();
    assert.notEqual(outdated.status, 0);
    assert.match(outdated.stderr, /upgrade/i);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
    const missing = join(f.directory, 'missing.sqlite');
    const result = spawnSync(process.execPath, [command, '--username', 'study-admin'], {
      input: 'valid-test-password\n', encoding: 'utf8', env: { ...process.env, DATABASE_PATH: missing },
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(missing), false);
  } finally { f.close(); }
});
