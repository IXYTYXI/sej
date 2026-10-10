import { handle } from '../../../lib/server';
export async function POST(request: Request) { return handle(request,(service,body)=>service.settings(body)); }
