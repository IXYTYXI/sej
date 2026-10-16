import { handleAi } from '../../../lib/ai/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request:Request) { return handleAi(request,'run'); }
