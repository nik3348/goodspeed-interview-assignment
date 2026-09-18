import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/session';

export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every path except static assets and image files. Auth checks belong on
     * requests that can render or mutate something, not on bundle downloads.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
};
