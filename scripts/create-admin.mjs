import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../lib/auth-password.ts';

class InputError extends Error {}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--username' || !/^[A-Za-z0-9_-]{2,32}$/.test(args[1])) {
    throw new InputError('Usage: node scripts/create-admin.mjs --username NAME; supply the password through stdin only.');
  }
  const username = args[1];
  if (username.toLowerCase() === (process.env.AUTH_USERNAME || 'yc').toLowerCase()) {
    throw new InputError('The initial owner username is reserved. Choose a different username.');
  }
  const path = process.env.DATABASE_PATH;
  if (!path || !existsSync(path)) throw new InputError('Set DATABASE_PATH to an existing Wordsteps database.');
  if (process.stdin.isTTY) throw new InputError('Supply the password through a secure stdin prompt; command-line passwords are not accepted.');

  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
    if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'role')) {
      throw new InputError('Upgrade and start Wordsteps before creating an administrator.');
    }
    if (db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username)) {
      throw new InputError('This username already exists; no account or password was changed.');
    }
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 4096) throw new InputError('Password must contain 12–1024 characters.');
    }
    const password = input.replace(/\r?\n$/, '');
    if (password.length < 12 || password.length > 1024) throw new InputError('Password must contain 12–1024 characters.');
    const passwordHash = await hashPassword(password);
    const result = db.prepare("INSERT INTO users(id,username,password_hash,created_at,role) VALUES (?,?,?,?,'admin') ON CONFLICT DO NOTHING")
      .run(randomBytes(16).toString('base64url'), username, passwordHash, Date.now());
    if (Number(result.changes) !== 1) throw new InputError('This username already exists; no account or password was changed.');
    process.stdout.write(JSON.stringify({ created: true, username, role: 'admin' }) + '\n');
  } finally { db.close(); }
}

try { await main(); }
catch (error) {
  // Never echo input, hashes, command arguments, or raw database errors.
  process.stderr.write((error instanceof InputError ? error.message : 'Administrator creation failed; no existing account was modified.') + '\n');
  process.exitCode = 1;
}
