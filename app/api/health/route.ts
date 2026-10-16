import { getDatabase } from '../../../db/sqlite';
import { getAuthConfig } from '../../../lib/auth-config';
import { json } from '../../../lib/server-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    getAuthConfig();
    await getDatabase().prepare('SELECT 1 AS ready').first();
    return json({ status: 'ok' });
  } catch { return json({ status: 'unavailable' }, 503); }
}
