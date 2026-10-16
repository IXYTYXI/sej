/** The same build-time base path is used by Next routes, links and browser API calls. */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
export function appPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  return `${basePath}${path}`;
}
