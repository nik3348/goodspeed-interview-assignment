/**
 * Supabase returns operational strings. Rewrite the ones a person can actually
 * act on, and pass anything unrecognised through rather than flattening it to a
 * vague apology — an unexpected error is more useful in its own words.
 */
const AUTH_ERROR_COPY: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /invalid login credentials/i,
    'That email and password do not match an account.',
  ],
  [
    /email not confirmed/i,
    'Confirm your email first — the link is in your inbox.',
  ],
  [
    /user already registered/i,
    'That email already has an account. Sign in instead.',
  ],
  [
    /unable to validate email address/i,
    'That email address does not look right.',
  ],
  [
    /for security purposes|rate limit|too many requests/i,
    'Too many attempts. Wait a moment, then try again.',
  ],
  [
    /failed to fetch|network|load failed/i,
    'Could not reach the server. Check your connection and try again.',
  ],
];

export function authErrorMessage(message: string): string {
  for (const [pattern, copy] of AUTH_ERROR_COPY) {
    if (pattern.test(message)) {
      return copy;
    }
  }

  return message;
}
