import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthController } from './auth.controller';
import { SupabaseAuthGuard } from './supabase-auth.guard';

/**
 * Registers authentication globally: routes require a valid Supabase session
 * unless they are explicitly marked `@Public()`.
 */
@Module({
  controllers: [AuthController],
  providers: [{ provide: APP_GUARD, useClass: SupabaseAuthGuard }],
})
export class AuthModule {}
