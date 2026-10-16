import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getUserForHeaders } from './auth';

export async function requireUser() {
  const user = await getUserForHeaders(await headers());
  // Next adds its configured basePath to server redirects.
  if (!user) redirect('/login');
  return user;
}
