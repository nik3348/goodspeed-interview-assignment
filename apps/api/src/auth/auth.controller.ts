import { Controller, Get } from '@nestjs/common';
import type { AuthenticatedUser } from '@repo/contracts';

import { CurrentUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  /**
   * Echoes the verified caller. The web app uses it to confirm that its session
   * is accepted by the API, not only by Supabase.
   */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
