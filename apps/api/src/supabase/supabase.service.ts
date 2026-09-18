import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Environment } from '../config/environment';

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
  private readonly secretKey: string;
  private adminClient: SupabaseClient | null = null;

  constructor(configService: ConfigService<Environment, true>) {
    this.url = configService.get('SUPABASE_URL', { infer: true });
    this.publishableKey = configService.get('SUPABASE_PUBLISHABLE_KEY', {
      infer: true,
    });
    this.secretKey = configService.get('SUPABASE_SECRET_KEY', { infer: true });
  }

  /** A client that acts as the signed-in user, subject to row-level security. */
  forUser(accessToken: string): SupabaseClient {
    return createClient(this.url, this.publishableKey, {
      auth: SERVER_AUTH_OPTIONS,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }

  /** A client that bypasses row-level security. Use only without a caller. */
  get admin(): SupabaseClient {
    this.adminClient ??= createClient(this.url, this.secretKey, {
      auth: SERVER_AUTH_OPTIONS,
    });

    return this.adminClient;
  }
}
