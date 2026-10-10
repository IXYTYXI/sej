export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new ApiError(400, '请求格式不正确');
  return value as Record<string, unknown>;
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160) throw new ApiError(400, '无效的标识');
  return value;
}
export async function readBody(request: Request): Promise<unknown> {
  const origin = request.headers.get('origin');
  const configuredOrigin = process.env.APP_ORIGIN;
  if (!configuredOrigin && process.env.NODE_ENV === 'production') throw new ApiError(503, '服务地址尚未配置');
  let expectedOrigin: string;
  try {
    const configured = new URL(configuredOrigin || request.url);
    if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password) throw new Error('Invalid origin');
    expectedOrigin = configured.origin;
  } catch { throw new ApiError(503, '服务地址配置不正确'); }
  if (!origin || origin !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, '请从本站提交操作');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, '请使用 JSON 请求');
  if (Number(request.headers.get('content-length')) > 32768) throw new ApiError(413, '请求内容过大');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, '请求内容为空');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const {done, value} = await reader.read(); if (done) break;
    length += value.length;
    if (length > 32768) { await reader.cancel(); throw new ApiError(413, '请求内容过大'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError(400, 'JSON 格式不正确'); }
}
export function json(data: unknown, status = 200): Response {
  return Response.json(data, {status, headers: {'Cache-Control':'private, no-store', 'Vary':'Cookie', 'X-Content-Type-Options':'nosniff'}});
}
export function languageParam(request: Request): 'en' | 'ja' {
  const value = new URL(request.url).searchParams.get('language') ?? 'en';
  if (value !== 'en' && value !== 'ja') throw new ApiError(400, '请选择英语或日语');
  return value;
}
