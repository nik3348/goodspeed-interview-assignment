import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { ApiExceptionFilter } from './api-exception.filter';

/**
 * Registers the error envelope through DI rather than in `bootstrap`, so tests
 * that build the app from `AppModule` get the same behaviour as production.
 */
@Module({
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class CommonModule {}
