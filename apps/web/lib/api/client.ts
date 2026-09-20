import { apiErrorSchema, type ApiError } from '@repo/contracts';
import type { ZodType } from 'zod';

/** A failed API call, carrying the server's structured error. */
export class ApiClientError extends Error {
  constructor(readonly apiError: ApiError) {
    super(apiError.message);
    this.name = 'ApiClientError';
  }

  get statusCode(): number {
    return this.apiError.statusCode;
  }

  get code(): string {
    return this.apiError.code;
  }
}

export interface ApiRequestOptions<T> extends Omit<RequestInit, 'body'> {
  /** Serialised as JSON. */
  body?: unknown;
  /** Validates the response, so a contract drift fails here and not in a view. */
  schema?: ZodType<T>;
}

export interface ApiClient {
  request<T = unknown>(path: string, options?: ApiRequestOptions<T>): Promise<T>;
  /**
   * The raw `Response`, for endpoints whose body is consumed incrementally.
   * Errors are still translated, so a caller only ever receives a live stream.
   */
  stream(path: string, options?: ApiRequestOptions<never>): Promise<Response>;
}

/**
 * Builds a client for the NestJS API.
 *
 * The token is supplied by a callback rather than held on the client, because
 * the browser and the server read the session from different places and the
 * access token is refreshed underneath us. Resolving it per request means a
 * long-lived client never sends a stale one.
 */
export function createApiClient(
  getAccessToken: () => Promise<string | null>,
  baseUrl: string = requireBaseUrl(),
): ApiClient {
  async function send(
    path: string,
    options: ApiRequestOptions<unknown>,
  ): Promise<Response> {
    const { body, schema: _schema, headers, ...init } = options;
    const accessToken = await getAccessToken();

    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      throw new ApiClientError(await toApiError(response));
    }

    return response;
  }

  return {
    async stream(path, options = {}) {
      return send(path, { ...options, method: options.method ?? 'POST' });
    },

    async request<T>(path: string, options: ApiRequestOptions<T> = {}) {
      const { schema } = options;
      const response = await send(path, options);

      if (response.status === 204) {
        return undefined as T;
      }

      const payload: unknown = await response.json();

      return schema ? schema.parse(payload) : (payload as T);
    },
  };
}

async function toApiError(response: Response): Promise<ApiError> {
  const parsed = apiErrorSchema.safeParse(
    await response.json().catch(() => null),
  );

  if (parsed.success) {
    return parsed.data;
  }

  // The API always returns the envelope; anything else means we did not reach
  // it — a proxy, a network error page, or a crash before the filter ran.
  return {
    statusCode: response.status,
    code: 'unexpected_response',
    message: 'The API returned an unexpected response.',
  };
}

function requireBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;

  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_API_URL is not set.');
  }

  return baseUrl;
}
