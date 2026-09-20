import { Global, Module } from '@nestjs/common';

import { SupabaseUserClient } from './supabase-user-client';
import { SupabaseService } from './supabase.service';

/**
 * Global because database access is cross-cutting: every feature module needs
 * a client, and none of them should have to re-wire this plumbing.
 */
@Global()
@Module({
  providers: [SupabaseService, SupabaseUserClient],
  exports: [SupabaseService, SupabaseUserClient],
})
export class SupabaseModule {}
