import { handle } from '../../../lib/server';
import { ApiError, languageParam } from '../../../lib/server-http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(request,service=>{
    const params=new URL(request.url).searchParams;
    const mode=params.get('mode')??'scheduled';
    if(mode!=='scheduled'&&mode!=='practice')throw new ApiError(400,'请选择有效的学习模式');
    return service.study(languageParam(request),params.get('stageId')??undefined,mode);
  });
}
