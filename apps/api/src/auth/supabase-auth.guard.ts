import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { authenticatedUserSchema } from '@repo/contracts';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import type { Environment } from '../config/environment';

import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthenticatedRequest } from './request-auth';

/** Supabase issues access tokens to signed-in users with this audience. */
const SUPABASE_AUDIENCE = 'authenticated';

/**
 * Authenticates requests by verifying the Supabase access token in the
 * `Authorization` header.
 *
 * Verification is local: the project's public keys are fetched once from the
 * JWKS endpoint and cached, so a request costs a signature check rather than a
 * round trip to the auth server. `jose` re-fetches automatically when it sees a
 * key id it does not know, which is what makes key rotation a non-event here.
 *
 * The guard only establishes *who* is calling. *What* they may touch stays with
 * row-level security in Postgres — see `SupabaseService`.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly issuer: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly reflector: Reflector,
    configService: ConfigService<Environment, true>,
  ) {
    const supabaseUrl = configService
      .get('SUPABASE_URL', { infer: true })
      .replace(/\/+$/, '');

    this.issuer = `${supabaseUrl}/auth/v1`;
    this.jwks = createRemoteJWKSet(
      new URL(`${this.issuer}/.well-known/jwks.json`),
      { cacheMaxAge: 10 * 60 * 1000 },
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<
      AuthenticatedRequest & { headers: Record<string, string | undefined> }
    >();

    const accessToken = extractBearerToken(request.headers.authorization);

    if (!accessToken) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    const payload = await this.verify(accessToken);
    const user = authenticatedUserSchema.safeParse({
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      expiresAt: payload.exp,
    });

    if (!user.success) {
      throw new UnauthorizedException('Access token is missing required claims.');
    }

    request.auth = { user: user.data, accessToken };

    return true;
  }

  private async verify(accessToken: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(accessToken, this.jwks, {
        issuer: this.issuer,
        audience: SUPABASE_AUDIENCE,
      });

      return payload;
    } catch {
      // Deliberately opaque: the caller learns the token was rejected, not
      // which check rejected it.
      throw new UnauthorizedException('Access token is invalid or expired.');
    }
  }
}

function extractBearerToken(header: string | undefined): string | null {
  const [scheme, token] = header?.split(' ') ?? [];

  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
