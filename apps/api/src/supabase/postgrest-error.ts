import {
  ConflictException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';

const logger = new Logger('Postgrest');

/** No rows came back from a query that used `.single()`. */
const NO_ROWS = 'PGRST116';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * Translates a PostgREST failure into the HTTP exception it deserves.
 *
 * Note what row-level security does to the not-found case: a row owned by
 * someone else is simply not visible, so an update or delete against it
 * returns no rows and surfaces here as a 404. That is the right answer —
 * distinguishing "does not exist" from "exists but is not yours" would leak
 * the existence of other users' documents.
 */
export function throwPostgrestError(
  error: PostgrestError,
  resource: string,
): never {
  switch (error.code) {
    case NO_ROWS:
      throw new NotFoundException(`No such ${resource}.`);

    case UNIQUE_VIOLATION:
      throw new ConflictException(`That ${resource} already exists.`);

    case FOREIGN_KEY_VIOLATION:
      throw new NotFoundException(`A referenced ${resource} does not exist.`);

    case CHECK_VIOLATION:
      // A database constraint the request schema should have caught first.
      logger.warn(`Check constraint rejected a ${resource}: ${error.message}`);
      throw new ConflictException(`That ${resource} is not valid.`);

    case INSUFFICIENT_PRIVILEGE:
      // RLS normally hides rows rather than refusing them, so reaching here
      // means a policy or grant is missing, not that the caller misbehaved.
      logger.error(`Denied by policy on ${resource}: ${error.message}`);
      throw new InternalServerErrorException();

    default:
      logger.error(
        `Unhandled PostgREST error on ${resource} (${error.code}): ${error.message}`,
        error.details ?? undefined,
      );
      throw new InternalServerErrorException();
  }
}
