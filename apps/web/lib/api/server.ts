import 'server-only';

import { createClient } from '@/lib/supabase/server';

import { createApiClient, type ApiClient } from './client';

/**
 * API client for server components and route handlers. Same contract as the
 * browser client, reading the session from the request's cookies instead.
 */
export async function serverApiClient(): Promise<ApiClient> {
  const supabase = await createClient();

  return createApiClient(async () => {
    const { data } = await supabase.auth.getSession();

    return data.session?.access_token ?? null;
  });
}
