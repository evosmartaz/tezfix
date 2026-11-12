import { NextResponse, type NextRequest } from 'next/server';
import { BASE_PATH, secureCookies } from './lib/env';
import { decideProxy } from './lib/session/proxy-logic';

/** Strips the basePath when the runtime leaves it on `nextUrl.pathname`. */
export function stripBasePath(pathname: string): string {
  if (pathname === BASE_PATH) return '/';
  return pathname.startsWith(`${BASE_PATH}/`) ? pathname.slice(BASE_PATH.length) : pathname;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const pathname = stripBasePath(request.nextUrl.pathname);
  const cookies: Record<string, string | undefined> = {};
  for (const c of request.cookies.getAll()) cookies[c.name] = c.value;

  const decision = await decideProxy({
    pathname,
    pathWithSearch: pathname + request.nextUrl.search,
    cookies,
    nowMs: Date.now(),
    secure: secureCookies(),
  });

  let response: NextResponse;
  if (decision.type === 'redirect') {
    const url = request.nextUrl.clone();
    const [path, query] = decision.location.split('?');
    url.pathname = path;
    url.search = query ? `?${query}` : '';
    response = NextResponse.redirect(url);
  } else if (decision.type === 'unauthorized') {
    response = NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 },
    );
  } else {
    for (const [name, value] of Object.entries(decision.requestCookies)) {
      if (value === null) request.cookies.delete(name);
      else request.cookies.set(name, value);
    }
    response = NextResponse.next({ request: { headers: request.headers } });
  }
  for (const c of decision.setCookies) response.cookies.set(c.name, c.value, c.options);
  return response;
}

export const config = {
  // Everything except static assets; the logic itself only acts on /admin, /company and /bff.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js|map|txt)$).*)',
  ],
};
