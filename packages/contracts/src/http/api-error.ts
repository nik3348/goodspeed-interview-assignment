import { z } from 'zod';

/**
 * The single error envelope every API route returns, so the web app has one
 * shape to narrow on instead of guessing at Nest's default error bodies.
 */
export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  /** Stable, machine-readable discriminator, e.g. `unauthorized`. */
  code: z.string(),
  /** Human-readable message, safe to surface in the UI. */
  message: z.string(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
