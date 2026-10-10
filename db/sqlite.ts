import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Database, DatabaseValue, PreparedStatement, RunResult } from '../lib/database';

export interface SQLiteDatabase extends Database { close(): void }

export function openDatabase(filePath: string, migrationsDirectory = resolve(process.cwd(), 'drizzle')): SQLiteDatabase {
  if (filePath !== ':memory:') mkdirSync(dirname(resolve(filePath)), { recursive: true, mode: 0o700 });
  const connection = new DatabaseSync(filePath);
  try {
    connection.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    connection.exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    const files = readdirSync(migrationsDirectory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
    if (!files.length) throw new Error('No database migrations were found');
    for (const name of files) {
      const sql = readFileSync(resolve(migrationsDirectory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      connection.exec('BEGIN IMMEDIATE');
      try {
        const saved = connection.prepare('SELECT checksum FROM schema_migrations WHERE name=?').get(name);
        if (saved && saved.checksum !== checksum) throw new Error(`Applied database migration changed: ${name}`);
        if (!saved) {
          connection.exec(sql);
          connection.prepare('INSERT INTO schema_migrations(name,checksum,applied_at) VALUES (?,?,?)').run(name, checksum, Date.now());
        }
        connection.exec('COMMIT');
      } catch (error) { connection.exec('ROLLBACK'); throw error; }
    }
  } catch (error) { connection.close(); throw error; }

  const statements = new WeakMap<PreparedStatement, { sql: string; values: DatabaseValue[] }>();
  const prepare = (sql: string, values: DatabaseValue[] = []): PreparedStatement => {
    const statement: PreparedStatement = {
      bind: (...args) => prepare(sql, args),
      async first<T>() { return (connection.prepare(sql).get(...values) ?? null) as T | null; },
      async all<T>() { return { results: connection.prepare(sql).all(...values) as T[] }; },
      async run() { return { meta: { changes: Number(connection.prepare(sql).run(...values).changes) } }; },
    };
    statements.set(statement, { sql, values });
    return statement;
  };
  let closed = false;
  return {
    prepare,
    async batch(batch) {
      const queries = batch.map(statement => {
        const query = statements.get(statement);
        if (!query) throw new Error('Cannot batch a statement from a different database');
        return query;
      });
      connection.exec('BEGIN IMMEDIATE');
      try {
        const results: RunResult[] = queries.map(({ sql, values }) => ({ meta: { changes: Number(connection.prepare(sql).run(...values).changes) } }));
        connection.exec('COMMIT');
        return results;
      } catch (error) { connection.exec('ROLLBACK'); throw error; }
    },
    close() { if (!closed) { connection.close(); closed = true; } },
  };
}

const globalDatabase = globalThis as typeof globalThis & { wordstepsDatabase?: SQLiteDatabase };
export function getDatabase(): Database {
  return globalDatabase.wordstepsDatabase ??= openDatabase(process.env.DATABASE_PATH || resolve(process.cwd(), '.data', 'wordsteps.sqlite'));
}
