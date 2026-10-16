import { hashPassword } from '../lib/auth-password.ts';

if (process.stdin.isTTY) {
  console.error('Read a password securely, then pipe it to this command via stdin. The password is never accepted as a command argument.');
  process.exit(1);
}
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 4096) throw new Error('Password input is too long');
}
const password = input.replace(/\r?\n$/, '');
process.stdout.write(await hashPassword(password) + '\n');
