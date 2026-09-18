import { createClient } from '@/lib/supabase/client';

import { createApiClient, type ApiClient } from './client';

/**
 * API client for client components. Reads the access token from the session
 * that `@supabase/ssr` keeps in cookies, which the proxy has already refreshed.
 */
export function browserApiClient(): ApiClient {
  return createApiClient(async () => {
    const { data } = await createClient().auth.getSession();

    return data.session?.access_token ?? null;
  });
}
