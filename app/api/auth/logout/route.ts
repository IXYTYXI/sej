import { authenticationCookie, getAuthService } from '../../../../lib/auth';
import { ApiError, json, object, readBody } from '../../../../lib/server-http';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    object(await readBody(request), []);
    await getAuthService().logout(request.headers);
    const response = json({ ok: true });
    response.headers.set('Set-Cookie', authenticationCookie('', 0));
    return response;
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    console.error('Logout request failed');
    return json({ error: '暂时无法退出，请稍后重试' }, 500);
  }
}
