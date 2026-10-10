import { readFileSync } from 'node:fs';

export type ProviderId = 'anthropic' | 'openai';
export type ProviderConfig = { id:ProviderId; label:string; model:string; enabled:boolean; endpoint:string; apiKey:string };
export type ProviderEnvironment = Record<string,string|undefined>;

/** Configuration is exclusively supplied by the server, never by an API request. */
export function providerEndpoint(baseUrl:string, provider:ProviderId):string {
  const url = new URL(baseUrl.trim());
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid AI provider URL');
  const path = url.pathname.replace(/\/+$/,'');
  url.pathname = `${path.endsWith('/v1') ? path : `${path}/v1`}/${provider === 'anthropic' ? 'messages' : 'chat/completions'}`;
  return url.toString();
}

function secret(env:ProviderEnvironment,prefix:string):string {
  const direct = env[`${prefix}_API_KEY`]?.trim();
  if (direct) return direct;
  const filename = env[`${prefix}_API_KEY_FILE`]?.trim();
  if (!filename) return '';
  try {
    // Docker secret mounts and ordinary local secret files are supported. Never log them.
    const content = readFileSync(filename,'utf8');
    return content.length <= 16384 ? content.trim() : '';
  } catch { return ''; }
}

export function configuredProviders(env:ProviderEnvironment = process.env):ProviderConfig[] {
  return (['anthropic','openai'] as const).map(id => {
    const prefix = id.toUpperCase();
    const model = env[`${prefix}_MODEL`]?.trim() || (id === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini');
    const apiKey = secret(env,prefix);
    let endpoint = '';
    try { endpoint = providerEndpoint(env[`${prefix}_BASE_URL`] || (id === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com'),id); } catch { /* Invalid server configuration disables this provider. */ }
    return {id,label:id === 'anthropic' ? 'Claude' : 'OpenAI',model,endpoint,apiKey,enabled:Boolean(apiKey && endpoint && model.length <= 200 && !/[\r\n]/.test(model) && !/[\r\n]/.test(apiKey))};
  });
}
