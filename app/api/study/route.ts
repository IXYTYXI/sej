import { handle } from '../../../lib/server';
import { languageParam } from '../../../lib/server-http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handle(request,service=>service.study(languageParam(request),new URL(request.url).searchParams.get('stageId')??undefined)); }
