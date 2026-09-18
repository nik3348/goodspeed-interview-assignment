import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import type { Environment } from './config/environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Environment, true>);

  // The browser calls this API directly with a bearer token, so only the known
  // web origins may do so. Credentials stay off: the session lives in the
  // Authorization header, never in a cookie sent to this origin.
  app.enableCors({
    origin: config.get('WEB_ORIGINS', { infer: true }),
    credentials: false,
  });

  // Payload validation is per-route via `ZodValidationPipe`, using the
  // schemas in `@repo/contracts` that the web app validates against too.
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
