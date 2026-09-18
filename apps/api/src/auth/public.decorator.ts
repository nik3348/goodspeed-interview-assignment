import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Opts a route out of authentication. The guard is registered globally, so
 * routes are protected by default and every exception is visible at its
 * declaration site.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
