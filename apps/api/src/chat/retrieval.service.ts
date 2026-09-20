import { Inject, Injectable, Logger } from '@nestjs/common';
import { toVectorLiteral, type MatchedChunkRow } from '@repo/database';

import { EMBEDDING_MODEL, type EmbeddingModel } from '../ai/embedding-model';
import { throwPostgrestError } from '../supabase/postgrest-error';
import { SupabaseUserClient } from '../supabase/supabase-user-client';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  similarity: number;
}

export interface RetrievalOptions {
  /** Restricts the search to these documents. Omitted means all of them. */
  documentIds?: string[];
  /** Most recent turns, oldest first, used to disambiguate the question. */
  history?: string[];
  limit?: number;
  minSimilarity?: number;
}

const DEFAULTS = {
  limit: 8,
  /**
   * Deliberately permissive. The model is instructed to say when the context
   * does not answer the question, which handles a weak match better than a
   * threshold that returns nothing and makes the assistant look broken. Its
   * real job is to drop the tail once enough good matches exist.
   */
  minSimilarity: 0.15,
  /** How many previous turns to fold into the search text. */
  historyTurns: 2,
} as const;

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    @Inject(EMBEDDING_MODEL) private readonly embeddings: EmbeddingModel,
    private readonly supabase: SupabaseUserClient,
  ) {}

  async retrieve(
    question: string,
    options: RetrievalOptions = {},
  ): Promise<RetrievedChunk[]> {
    const { embeddings } = await this.embeddings.embed({
      inputs: [toSearchText(question, options.history ?? [])],
    });

    const queryEmbedding = embeddings[0];

    if (!queryEmbedding) {
      this.logger.warn('The embedding provider returned no query vector.');
      return [];
    }

    // Filtering and ranking happen inside the SQL function so the planner can
    // combine them with the vector predicate, and so row-level security — not
    // an argument this code passes — decides whose chunks are searched.
    const { data, error } = await this.supabase.db.rpc(
      'match_document_chunks',
      {
        query_embedding: toVectorLiteral(queryEmbedding),
        match_threshold: options.minSimilarity ?? DEFAULTS.minSimilarity,
        match_count: options.limit ?? DEFAULTS.limit,
        ...(options.documentIds === undefined
          ? {}
          : { filter_document_ids: options.documentIds }),
      },
    );

    if (error) {
      throwPostgrestError(error, 'document chunk');
    }

    return (data as MatchedChunkRow[]).map((row) => ({
      chunkId: row.id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      content: row.content,
      similarity: row.similarity,
    }));
  }
}

/**
 * Builds the text that gets embedded for the search.
 *
 * A follow-up like "why is that?" embeds to almost nothing useful on its own,
 * so the preceding turns are folded in to carry the subject forward. The
 * question is repeated at the end so it still dominates the resulting vector
 * rather than being outweighed by older text.
 *
 * A model call to rewrite the query properly would retrieve better, at the
 * cost of a round trip before every search; this buys most of the benefit for
 * nothing.
 */
function toSearchText(question: string, history: string[]): string {
  const recent = history.slice(-DEFAULTS.historyTurns);

  return recent.length === 0 ? question : [...recent, question].join('\n');
}
