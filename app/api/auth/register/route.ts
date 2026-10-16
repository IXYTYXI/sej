import { authenticationCookie, getAuthService } from '../../../../lib/auth';
import { ApiError, json, readBody } from '../../../../lib/server-http';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const session = await getAuthService().register(body);
    const response = json({ user: session.user });
    response.headers.set('Set-Cookie', authenticationCookie(session.token, session.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      const response = json({ error: error.message }, error.status);
      if (error.status === 429) response.headers.set('Retry-After', '900');
      return response;
    }
    console.error('Registration request failed');
    return json({ error: '暂时无法注册，请稍后重试' }, 500);
  }
}
