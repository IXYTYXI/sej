import { handleAi } from '../../../../lib/ai/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request:Request) { return handleAi(request,'status'); }
