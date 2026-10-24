import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('SQLite persists learning records after close and reopening without repeating migrations', async () => {
  const { openDatabase } = await import('../db/sqlite.ts');
  const directory = mkdtempSync(join(tmpdir(), 'wordsteps-sqlite-'));
  const path = join(directory, 'nested', 'learning.sqlite');
  let db;
  try {
    db = openDatabase(path);
    await db.prepare('INSERT INTO learners(user_id,daily_new_limit) VALUES (?,?)').bind('owner', 17).run();
    db.close();
    db = openDatabase(path);
    assert.equal((await db.prepare('SELECT daily_new_limit FROM learners WHERE user_id=?').bind('owner').first()).daily_new_limit, 17);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').first()).n >= 2, true);
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('role migration upgrades existing users without changing sessions or learning records', async () => {
  const { openDatabase } = await import('../db/sqlite.ts');
  const directory = mkdtempSync(join(tmpdir(), 'wordsteps-role-migrate-'));
  const migrations = join(directory, 'legacy-migrations');
  const path = join(directory, 'learning.sqlite');
  mkdirSync(migrations);
  const source = new URL('../drizzle/', import.meta.url);
  for (const name of readdirSync(source).filter(name => /^000[0-3]_.*\.sql$/.test(name))) copyFileSync(new URL(name, source), join(migrations, name));
  let db;
  try {
    db = openDatabase(path, migrations);
    for (const [id, username] of [['owner', 'yc'], ['registered', 'friend']]) {
      await db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)').bind(id, username, `hash-${id}`, 123).run();
    }
    await db.prepare("INSERT INTO auth_sessions(token_hash,auth_version,user_id,expires_at,created_at) VALUES ('token','version','registered',456,123)").run();
    await db.prepare("INSERT INTO learners(user_id,daily_new_limit) VALUES ('registered',17)").run();
    db.close();
    db = openDatabase(path);
    const owner = await db.prepare("SELECT * FROM users WHERE id='owner'").first();
    assert.equal(owner.role, 'admin');
    assert.deepEqual({ ...owner }, { id: 'owner', username: 'yc', password_hash: 'hash-owner', created_at: 123, role: 'admin' });
    assert.equal((await db.prepare("SELECT role FROM users WHERE id='registered'").first()).role, 'user');
    assert.equal((await db.prepare("SELECT user_id FROM auth_sessions WHERE token_hash='token'").first()).user_id, 'registered');
    assert.equal((await db.prepare("SELECT daily_new_limit FROM learners WHERE user_id='registered'").first()).daily_new_limit, 17);
    await db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES ('old-app','legacy-insert','hash',123)").run();
    assert.equal((await db.prepare("SELECT role FROM users WHERE id='old-app'").first()).role, 'user');
    await assert.rejects(db.prepare("UPDATE users SET role='superadmin' WHERE id='registered'").run(), /CHECK constraint/);
    await assert.rejects(db.prepare("UPDATE users SET role=NULL WHERE id='registered'").run(), /NOT NULL/);
    db.close();
    db = openDatabase(path);
    assert.equal((await db.prepare("SELECT role FROM users WHERE id='owner'").first()).role, 'admin');
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('SQLite batch rolls back all writes on error and reports successful changes', async () => {
  const { openDatabase } = await import('../db/sqlite.ts');
  const db = openDatabase(':memory:');
  try {
    const statement = () => db.prepare('INSERT INTO learners(user_id,daily_new_limit) VALUES (?,?)').bind('owner', 10);
    await assert.rejects(db.batch([statement(), statement()]), /UNIQUE/);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM learners').first()).n, 0);
    assert.equal((await db.batch([statement()]))[0].meta.changes, 1);
  } finally { db.close(); }
});

test('SQLite failed migration is atomic and can be retried after correction', async () => {
  const { openDatabase } = await import('../db/sqlite.ts');
  const directory = mkdtempSync(join(tmpdir(), 'wordsteps-migrate-'));
  const path = join(directory, 'db.sqlite');
  const migration = join(directory, '0000_test.sql');
  try {
    writeFileSync(migration, 'CREATE TABLE example(id TEXT PRIMARY KEY); INSERT INTO missing VALUES (1);');
    assert.throws(() => openDatabase(path, directory), /missing/);
    writeFileSync(migration, 'CREATE TABLE example(id TEXT PRIMARY KEY);');
    const db = openDatabase(path, directory);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM example').first()).n, 0);
    db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
