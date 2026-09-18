import { z } from 'zod';

/**
 * The subset of the Supabase access-token claims the API relies on.
 *
 * Supabase signs access tokens with the project's asymmetric key, so the API
 * verifies them against the published JWKS rather than calling back to the auth
 * server on every request. Only the claims we actually act on are modelled here
 * — everything else in the token stays out of the application's vocabulary.
 */
export const authenticatedUserSchema = z.object({
  /** `sub` claim: the Supabase user id, and the owner column on every row. */
  id: z.uuid(),
  email: z.email().optional(),
  /** `authenticated` for a signed-in user, `anon` for a public token. */
  role: z.string(),
  /** Expiry, as seconds since the epoch. */
  expiresAt: z.number().int().positive(),
});

export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
