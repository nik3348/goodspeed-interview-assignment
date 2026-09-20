import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Database } from '@repo/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { ENVIRONMENT, type Environment } from '../config/environment';

/**
 * A Supabase client typed against the generated schema, so a column rename in
 * a migration surfaces as a build error rather than a runtime `undefined`.
 */
export type TypedSupabaseClient = SupabaseClient<Database>;

/** Server-side clients never persist or refresh sessions; the web app owns that. */
const SERVER_AUTH_OPTIONS = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

/**
 * Builds Supabase clients for the two access levels the API needs.
 *
 * The default is {@link forUser}: a client that forwards the caller's access
 * token, so Postgres evaluates row-level security as that user. Authorization
 * therefore lives in one place — the database — and the API cannot accidentally
 * read another user's rows even if a `where owner_id = ...` clause is forgotten.
 *
 * {@link admin} bypasses RLS and exists for work with no user to act as, such as
 * re-embedding documents in the background. Reach for it deliberately.
 */
@Injectable()
export class SupabaseService {
  private readonly url: string;
  private readonly publishableKey: string;
  private readonly secretKey: string | undefined;
  private adminClient: TypedSupabaseClient | null = null;

  constructor(@Inject(ENVIRONMENT) environment: Environment) {
    this.url = environment.SUPABASE_URL;
    this.publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;
    this.secretKey = environment.SUPABASE_SECRET_KEY;
  }

  /** A client that acts as the signed-in user, subject to row-level security. */
  forUser(accessToken: string): TypedSupabaseClient {
    return createClient<Database>(this.url, this.publishableKey, {
      auth: SERVER_AUTH_OPTIONS,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }

  /** A client that bypasses row-level security. Use only without a caller. */
  get admin(): TypedSupabaseClient {
    if (!this.secretKey) {
      throw new InternalServerErrorException(
        'SUPABASE_SECRET_KEY is not configured, so the privileged client is unavailable.',
      );
    }

    this.adminClient ??= createClient<Database>(this.url, this.secretKey, {
      auth: SERVER_AUTH_OPTIONS,
    });

    return this.adminClient;
  }
}
