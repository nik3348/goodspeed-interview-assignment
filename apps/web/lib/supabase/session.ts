import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Pages a signed-out visitor may reach. */
const AUTH_ROUTES = ['/sign-in', '/sign-up'];

/** Route handlers that must stay reachable in both states, e.g. sign-out. */
const CALLBACK_ROUTES = ['/auth'];

/**
 * Refreshes the Supabase session on every request and enforces the
 * signed-in/signed-out split.
 *
 * This runs in the proxy so a stale access token is rotated *before* any page
 * renders or any call to the API is made; without it the browser would happily
 * send an expired token to NestJS and get a 401 on an otherwise valid session.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and supabase.auth.getClaims().
  // A simple mistake could make it very hard to debug issues with users being
  // randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims);

  const { pathname } = request.nextUrl;
  const isAuthRoute = matches(pathname, AUTH_ROUTES);
  const isCallbackRoute = matches(pathname, CALLBACK_ROUTES);

  if (!isSignedIn && !isAuthRoute && !isCallbackRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    // Remember where they were headed so sign-in can return them there.
    url.search = '';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (isSignedIn && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is. If you
  // create a new response, pass the request into it and copy the cookies over,
  // or the browser and server will fall out of sync and end the session early.
  return supabaseResponse;
}

function matches(pathname: string, routes: string[]): boolean {
  return routes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}
