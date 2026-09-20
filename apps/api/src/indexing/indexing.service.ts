import { Inject, Injectable, Logger } from '@nestjs/common';
import { toVectorLiteral, type DocumentChunkInsert } from '@repo/database';

import { AiError } from '../ai/ai.errors';
import { EMBEDDING_MODEL, type EmbeddingModel } from '../ai/embedding-model';
import type { TokenUsage } from '../ai/messages';
import { SupabaseUserClient } from '../supabase/supabase-user-client';

import { chunkDocument } from './chunker';

export type IndexingOutcome =
  | { status: 'indexed'; chunkCount: number; usage: TokenUsage | null }
  | { status: 'failed'; reason: string };

/** Kept short: it is stored in a column and shown to the user. */
const MAX_REASON_LENGTH = 500;

/**
 * Keeps a document's embedded chunks in step with its content.
 *
 * Ordering is the important decision here. Embedding is a network call to a
 * third party and the most likely thing to fail, so it happens *before* the
 * old chunks are deleted. A provider outage therefore leaves the previous
 * embeddings in place and the document still answerable, instead of emptying
 * the index and failing.
 *
 * Failure is recorded rather than thrown. A document that saved but could not
 * be embedded is a real state worth naming, and one a user can retry, which is
 * better than rejecting the write and losing what they typed.
 */
@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    @Inject(EMBEDDING_MODEL) private readonly embeddings: EmbeddingModel,
    private readonly supabase: SupabaseUserClient,
  ) {}

  async indexDocument(
    documentId: string,
    content: string,
  ): Promise<IndexingOutcome> {
    try {
      return await this.rebuild(documentId, content);
    } catch (error) {
      const reason = describe(error);

      this.logger.error(
        `Indexing document ${documentId} failed: ${reason}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.recordFailure(documentId, reason);

      return { status: 'failed', reason };
    }
  }

  private async rebuild(
    documentId: string,
    content: string,
  ): Promise<IndexingOutcome> {
    const chunks = chunkDocument(content);

    // Embed first: the slowest and most failure-prone step runs while the
    // previous chunks are still serving queries.
    const { embeddings, usage } = await this.embeddings.embed({
      inputs: chunks.map((chunk) => chunk.content),
    });

    const rows: DocumentChunkInsert[] = chunks.map((chunk, position) => ({
      document_id: documentId,
      // A trigger overwrites this with the document's owner, so the value here
      // is a convenience rather than a claim; see the initial migration.
      user_id: this.supabase.userId,
      chunk_index: chunk.index,
      content: chunk.content,
      token_count: chunk.tokenEstimate,
      embedding: toVectorLiteral(embeddings[position] ?? []),
      embedding_model: this.embeddings.model,
    }));

    const { error: deleteError } = await this.supabase.db
      .from('document_chunks')
      .delete()
      .eq('document_id', documentId);

    if (deleteError) {
      throw new Error(`could not clear existing chunks: ${deleteError.message}`);
    }

    if (rows.length > 0) {
      const { error: insertError } = await this.supabase.db
        .from('document_chunks')
        .insert(rows);

      if (insertError) {
        throw new Error(`could not store chunks: ${insertError.message}`);
      }
    }

    const { error: markError } = await this.supabase.db
      .from('documents')
      .update({ indexed_at: new Date().toISOString(), indexing_error: null })
      .eq('id', documentId);

    if (markError) {
      throw new Error(`could not record success: ${markError.message}`);
    }

    return { status: 'indexed', chunkCount: rows.length, usage };
  }

  private async recordFailure(
    documentId: string,
    reason: string,
  ): Promise<void> {
    const { error } = await this.supabase.db
      .from('documents')
      .update({ indexed_at: null, indexing_error: reason })
      .eq('id', documentId);

    if (error) {
      // Nothing left to do but say so; the original failure already stands.
      this.logger.error(
        `Could not record the indexing failure for ${documentId}: ${error.message}`,
      );
    }
  }
}

function describe(error: unknown): string {
  const message =
    error instanceof AiError || error instanceof Error
      ? error.message
      : 'Unknown error.';

  return message.slice(0, MAX_REASON_LENGTH);
}
