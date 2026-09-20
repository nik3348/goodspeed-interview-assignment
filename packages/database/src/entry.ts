export type { Database, Json } from './database.types';

import type { Database } from './database.types';

type PublicSchema = Database['public'];

/** A row as it exists in the database, snake_case and all. */
export type Tables<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Row'];

export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert'];

export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update'];

export type DocumentRow = Tables<'documents'>;
export type DocumentInsert = TablesInsert<'documents'>;
export type DocumentUpdate = TablesUpdate<'documents'>;

export type DocumentChunkRow = Tables<'document_chunks'>;
export type DocumentChunkInsert = TablesInsert<'document_chunks'>;

/** A row returned by the `match_document_chunks` similarity search. */
export type MatchedChunkRow =
  PublicSchema['Functions']['match_document_chunks']['Returns'][number];

/**
 * PostgREST serialises `vector` columns as a JSON array in a string, so an
 * embedding has to be stringified on the way in and parsed on the way out.
 */
export function toVectorLiteral(embedding: number[]): string {
  return JSON.stringify(embedding);
}

/**
 * The width of the `document_chunks.embedding` column, as declared in
 * `20260918130145_documents_and_chunks.sql`.
 *
 * Exported so the API can check its configured embedding model against the
 * schema at boot rather than discovering the mismatch on the first insert.
 * Changing this means writing a migration, not editing this constant.
 */
export const EMBEDDING_DIMENSIONS = 1536;
