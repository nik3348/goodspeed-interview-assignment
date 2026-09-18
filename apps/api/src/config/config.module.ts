import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { validateEnvironment } from './environment';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // `.env.local` holds developer secrets and is git-ignored; `.env` is for
      // values a deployment provides. Earlier entries win.
      envFilePath: ['.env.local', '.env'],
      validate: validateEnvironment,
    }),
  ],
})
export class ConfigModule {}
