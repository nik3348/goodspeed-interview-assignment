import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '@repo/contracts';

import { getRequestAuth } from './request-auth';

/** Injects the verified caller into a controller handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    getRequestAuth(context.switchToHttp().getRequest()).user,
);

/**
 * Injects the caller's raw access token, for the rare handler that needs to
 * build its own Supabase client rather than use the request-scoped one.
 */
export const AccessToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    getRequestAuth(context.switchToHttp().getRequest()).accessToken,
);
