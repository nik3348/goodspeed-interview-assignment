import { z } from 'zod';

/**
 * Every environment variable the API reads, validated once at boot so a
 * misconfigured deployment fails immediately instead of at the first request.
 */
const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  /** Base URL of the Supabase project, e.g. https://xyz.supabase.co */
  SUPABASE_URL: z.url(),
  /**
   * Publishable (anon) key. Used for the per-request client that carries the
   * caller's access token, so row-level security still applies inside the API.
   */
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  /**
   * Secret (service-role) key. Bypasses RLS, so it stays server-side and is
   * reserved for background work that has no user to act as.
   */
  SUPABASE_SECRET_KEY: z.string().min(1),

  /** Comma-separated origins allowed to call the API from a browser. */
  WEB_ORIGINS: z
    .string()
    .default('http://localhost:3001')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(raw: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
