import { getRequestUser } from '../auth';
import { getDatabase } from '../../db/sqlite';
import { catalog } from '../catalog';
import { ApiError, json, readBody } from '../server-http';
import { configuredProviders } from './config';
import { createAiService } from './service';

export async function handleAi(request:Request,action:'status'|'run'):Promise<Response> {
  try {
    const user = await getRequestUser(request);
    if (!user) throw new ApiError(401,'请先登录');
    const service = createAiService(getDatabase(),catalog,user,configuredProviders());
    return json(action === 'status' ? await service.status() : await service.run(await readBody(request)));
  } catch (error) {
    if (error instanceof ApiError) return json({error:error.message},error.status);
    // Avoid logging configuration, network exceptions or upstream payloads.
    return json({error:'AI 服务暂时不可用，请稍后重试'},500);
  }
}
