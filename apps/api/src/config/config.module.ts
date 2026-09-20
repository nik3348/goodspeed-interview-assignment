import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { ENVIRONMENT, validateEnvironment } from './environment';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // `.env.local` holds developer secrets and is git-ignored; `.env` is for
      // values a deployment provides. Earlier entries win.
      envFilePath: ['.env.local', '.env'],
      // Runs at import time, so a bad configuration stops the process here
      // rather than on the first request that happens to need the value.
      validate: validateEnvironment,
    }),
  ],
  providers: [
    {
      provide: ENVIRONMENT,
      // Parsed a second time rather than plucked field by field out of
      // ConfigService: the result is one typed object with defaults and
      // transforms already applied, which is what every consumer actually
      // wants. `ConfigModule` has merged the env files into `process.env` by
      // the time this factory runs, and validation is pure, so the second
      // parse is cheap and yields exactly the same value as the first.
      useFactory: () => validateEnvironment(process.env),
    },
  ],
  exports: [ENVIRONMENT],
})
export class ConfigModule {}
