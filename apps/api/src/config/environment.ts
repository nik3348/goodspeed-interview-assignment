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
   *
   * Optional because nothing on the request path needs it: every user-facing
   * query runs as the caller. Requiring it at boot would block a deployment
   * that never touches the privileged client. `SupabaseService.admin` fails
   * loudly if it is reached without one.
   */
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),

  // ---------------------------------------------------------------------
  // AI provider
  //
  // Any service speaking the OpenAI wire format works here, so switching
  // between OpenAI, Groq, Together, OpenRouter and a local Ollama is a
  // change to these values and nothing else. Chat and embeddings each get
  // an optional override, because running chat on a hosted provider and
  // embeddings on a local one is a common and sensible split.
  // ---------------------------------------------------------------------

  /** Base URL used for both roles unless one overrides it. */
  AI_BASE_URL: z.url().default('https://api.openai.com/v1'),
  /**
   * Optional: a local Ollama needs no credentials. The adapter sends a
   * placeholder in that case, because the OpenAI SDK requires some value.
   */
  AI_API_KEY: z.string().min(1).optional(),

  AI_CHAT_MODEL: z.string().min(1).default('gpt-4o-mini'),
  AI_CHAT_BASE_URL: z.url().optional(),
  AI_CHAT_API_KEY: z.string().min(1).optional(),

  AI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
  AI_EMBEDDING_BASE_URL: z.url().optional(),
  AI_EMBEDDING_API_KEY: z.string().min(1).optional(),
  /**
   * Requested vector width. When set it is sent to the provider, which
   * OpenAI's text-embedding-3-* family honours by truncating. When unset,
   * whatever the model natively returns is checked against the database
   * column instead.
   */
  AI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),
  /** Inputs per embedding request; providers differ in what they accept. */
  AI_EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(2048).default(96),

  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

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

/** Injection token for the validated environment. */
export const ENVIRONMENT = Symbol('ENVIRONMENT');

export function validateEnvironment(raw: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(withoutBlanks(raw));

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}

/**
 * Drops variables that are present but empty.
 *
 * A `.env` file routinely carries placeholder lines like `FOO=`, and dotenv
 * reports those as an empty string rather than as absent. Without this, an
 * unfilled placeholder fails validation instead of falling through to the
 * default or to `optional()`, which is rarely what the author meant.
 */
function withoutBlanks(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([, value]) => !(typeof value === 'string' && value.trim() === ''),
    ),
  );
}
