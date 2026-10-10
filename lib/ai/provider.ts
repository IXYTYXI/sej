import { ApiError } from '../server-http';
import type { ProviderConfig } from './config';

export type ChatMessage = {role:'user'|'assistant';content:string};
export type ModelPrompt = {system:string;messages:ChatMessage[];maxTokens:number};
export type FetchLike = typeof globalThis.fetch;
const MAX_BODY_BYTES = 262144;

async function responseJson(response:Response):Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new ApiError(502,'模型响应过大，请稍后重试');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502,'模型未返回有效内容，请稍后重试');
  const chunks:Uint8Array[] = [];
  let length = 0;
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new ApiError(502,'模型响应过大，请稍后重试'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError(502,'模型返回格式异常，请稍后重试'); }
}

/** Return untrusted plain text only. No model-generated commands or tool calls are executed. */
export async function requestCompletion(provider:ProviderConfig,prompt:ModelPrompt,options:{fetch?:FetchLike;timeoutMs?:number} = {}):Promise<string> {
  if (!provider.enabled) throw new ApiError(503,'所选 AI 服务尚未配置');
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  let timeout:ReturnType<typeof setTimeout> | undefined;
  const request = async () => {
    const anthropic = provider.id === 'anthropic';
    const headers:Record<string,string> = {'Content-Type':'application/json','Accept':'application/json'};
    if (anthropic) { headers['x-api-key'] = provider.apiKey; headers['anthropic-version'] = '2023-06-01'; }
    else headers.Authorization = `Bearer ${provider.apiKey}`;
    const body = anthropic
      ? {model:provider.model,system:prompt.system,messages:prompt.messages,max_tokens:prompt.maxTokens,stream:false}
      : {model:provider.model,messages:[{role:'system',content:prompt.system},...prompt.messages],max_tokens:prompt.maxTokens,stream:false};
    const response = await fetchImpl(provider.endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError(response.status === 429 ? 503 : 502,response.status === 429 ? '模型服务繁忙，请稍后重试' : '模型服务暂时不可用，请稍后重试');
    }
    const data = await responseJson(response) as {content?:{type?:string;text?:unknown}[];choices?:{message?:{content?:unknown}}[]};
    const raw = anthropic
      ? (Array.isArray(data?.content) ? data.content.filter(block=>block?.type === 'text' && typeof block.text === 'string').map(block=>block.text).join('\n') : undefined)
      : (Array.isArray(data?.choices) ? data.choices[0]?.message?.content : undefined);
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 16000) throw new ApiError(502,'模型未返回有效内容，请稍后重试');
    return raw.trim();
  };
  try {
    return await Promise.race([
      request(),
      new Promise<never>((_resolve,reject)=>{ timeout = setTimeout(()=>{reject(new ApiError(504,'模型响应超时，请稍后重试'));controller.abort();},options.timeoutMs ?? 45000); }),
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Fetch exceptions and upstream bodies may contain proxy credentials. Never expose or log them.
    throw new ApiError(502,'模型服务连接失败，请稍后重试');
  } finally {
    if (timeout) clearTimeout(timeout);
    controller.abort();
  }
}
