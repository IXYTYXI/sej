import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
