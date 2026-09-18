import type { AuthenticatedUser } from '@repo/contracts';

/**
 * What {@link SupabaseAuthGuard} attaches to the request once a token verifies.
 * The raw token is kept alongside the claims because the Supabase client needs
 * it verbatim to act as the user against row-level security.
 */
export interface RequestAuth {
  user: AuthenticatedUser;
  accessToken: string;
}

/** A request that has passed the auth guard. */
export interface AuthenticatedRequest {
  auth: RequestAuth;
}

export function getRequestAuth(request: unknown): RequestAuth {
  const auth = (request as Partial<AuthenticatedRequest>)?.auth;

  if (!auth) {
    throw new Error(
      'Request is not authenticated. Is SupabaseAuthGuard applied to this route?',
    );
  }

  return auth;
}
