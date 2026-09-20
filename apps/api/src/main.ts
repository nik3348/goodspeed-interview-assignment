import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
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

  // Payload validation is per-route via `ZodValidationPipe`, and the error
  // envelope is registered in `CommonModule`, so both apply in tests too.
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
