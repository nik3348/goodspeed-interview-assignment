/**
 * Provider failures, normalised.
 *
 * Callers should never have to catch a vendor SDK's error class or switch on
 * its status codes. The adapter translates into this hierarchy, so retry and
 * fallback policy can be written once and stay true after a provider swap.
 */
export abstract class AiError extends Error {
  protected constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Credentials were rejected: a configuration problem, not a user's fault. */
export class AiAuthenticationError extends AiError {
  constructor(cause?: unknown) {
    super('The AI provider rejected the configured credentials.', cause);
  }
}

/** Quota or rate limit. Worth retrying later; not worth retrying immediately. */
export class AiRateLimitError extends AiError {
  constructor(
    readonly retryAfterMs: number | null,
    cause?: unknown,
  ) {
    super('The AI provider is rate limiting this deployment.', cause);
  }
}

/** The prompt exceeded the model's window — the caller must send less. */
export class AiContextLengthError extends AiError {
  constructor(cause?: unknown) {
    super("The request exceeded the model's context window.", cause);
  }
}

/** Upstream is down, timed out, or unreachable. */
export class AiUnavailableError extends AiError {
  constructor(cause?: unknown) {
    super('The AI provider is unavailable.', cause);
  }
}

/** The deployment is misconfigured: wrong model name, wrong dimensions. */
export class AiConfigurationError extends AiError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}

/** The caller cancelled, usually because the HTTP client went away. */
export class AiCancelledError extends AiError {
  constructor(cause?: unknown) {
    super('The AI request was cancelled.', cause);
  }
}
