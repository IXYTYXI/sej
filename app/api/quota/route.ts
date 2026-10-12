import { handle } from '../../../lib/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request:Request) { return handle(request,(service,body)=>service.adjustQuota(body)); }
