import { Inject, Scope, type Provider } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getRequestAuth } from '../auth/request-auth';

import { SupabaseService } from './supabase.service';

export const SUPABASE_USER_CLIENT = Symbol('SUPABASE_USER_CLIENT');

/**
 * A Supabase client scoped to the current request's user.
 *
 * Feature services inject this and write plain queries; the caller's identity
 * rides along on every statement, so row-level security does the filtering.
 * Injecting it makes the consuming provider request-scoped, which is the
 * intended trade: a client instance per request in exchange for services that
 * cannot be called without an authenticated caller.
 */
export const supabaseUserClientProvider: Provider = {
  provide: SUPABASE_USER_CLIENT,
  scope: Scope.REQUEST,
  inject: [REQUEST, SupabaseService],
  useFactory: (request: unknown, supabase: SupabaseService): SupabaseClient =>
    supabase.forUser(getRequestAuth(request).accessToken),
};

/** Typed companion to {@link supabaseUserClientProvider}. */
export const InjectUserClient = () => Inject(SUPABASE_USER_CLIENT);
