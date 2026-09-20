import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';

import { getRequestAuth } from '../auth/request-auth';

import { SupabaseService, type TypedSupabaseClient } from './supabase.service';

/**
 * The Supabase client for the current request's user.
 *
 * The client is built on first access rather than in the constructor, and that
 * is load-bearing: Nest resolves a request-scoped provider *before* it runs
 * guards, so constructing eagerly would read the auth context while it is
 * still empty and turn every unauthenticated call into a 500 instead of a 401.
 * By the time a handler touches `db`, the guard has run.
 */
@Injectable({ scope: Scope.REQUEST })
export class SupabaseUserClient {
  private client: TypedSupabaseClient | null = null;

  constructor(
    @Inject(REQUEST) private readonly request: unknown,
    private readonly supabase: SupabaseService,
  ) {}

  /** The signed-in caller's id, for columns that record ownership. */
  get userId(): string {
    return getRequestAuth(this.request).user.id;
  }

  /** Queries through this client run as the caller, subject to RLS. */
  get db(): TypedSupabaseClient {
    this.client ??= this.supabase.forUser(
      getRequestAuth(this.request).accessToken,
    );

    return this.client;
  }
}
