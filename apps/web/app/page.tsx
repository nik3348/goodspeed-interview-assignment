import { authenticatedUserSchema } from '@repo/contracts';

import { ApiClientError } from '@/lib/api/client';
import { serverApiClient } from '@/lib/api/server';

import { SignOutButton } from './sign-out-button';

/**
 * Placeholder home for the signed-in app. It calls `/auth/me` so the page
 * proves the whole spine end to end: Supabase issued the session, the proxy
 * refreshed it, and NestJS verified the token independently.
 */
export default async function HomePage() {
  const api = await serverApiClient();

  let email: string | undefined;
  let apiError: string | null = null;

  try {
    const user = await api.request('/auth/me', {
      schema: authenticatedUserSchema,
    });
    email = user.email;
  } catch (error) {
    apiError =
      error instanceof ApiClientError
        ? error.message
        : 'Could not reach the API. Is it running on NEXT_PUBLIC_API_URL?';
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Knowledge base
        </h1>
        {apiError ? (
          <p role="alert" className="text-sm text-destructive">
            {apiError}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Signed in as {email ?? 'an authenticated user'}, verified by the
            API.
          </p>
        )}
      </div>
      <div>
        <SignOutButton />
      </div>
    </main>
  );
}
