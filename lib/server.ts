import { getDatabase } from '../db/sqlite';
import { getRequestUser } from './auth';
import { catalog } from './catalog';
import { createLearningService } from './server-core';
import { ApiError, json, readBody } from './server-http';
export type LearningService = ReturnType<typeof createLearningService>;
export async function handle(request: Request, action: (service: LearningService, body: unknown)=>Promise<unknown>) {
  try {
    const user = await getRequestUser(request);
    if (!user) throw new ApiError(401, '请先登录');
    const body = request.method === 'POST' ? await readBody(request) : undefined;
    return json(await action(createLearningService(getDatabase(),catalog,user),body));
  } catch (error) {
    if (error instanceof ApiError) return json({error:error.message},error.status);
    console.error('Learning API failed', error instanceof Error ? error.message : 'unknown error');
    return json({error:'暂时无法保存或读取学习记录，请稍后重试'},500);
  }
}
