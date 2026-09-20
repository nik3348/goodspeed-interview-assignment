import { Injectable } from '@nestjs/common';
import type {
  CreateDocument,
  Document,
  DocumentIndexing,
  DocumentList,
  DocumentSummary,
  ListDocumentsQuery,
  UpdateDocument,
} from '@repo/contracts';
import type { DocumentRow } from '@repo/database';

import {
  IndexingService,
  type IndexingOutcome,
} from '../indexing/indexing.service';
import { throwPostgrestError } from '../supabase/postgrest-error';
import { SupabaseUserClient } from '../supabase/supabase-user-client';

/**
 * Columns a list view needs. Bodies can be large, so they are left behind.
 * The embedded `document_chunks(count)` is an aggregate PostgREST computes in
 * the same round trip, which keeps the list from becoming N+1 queries.
 */
const SUMMARY_COLUMNS =
  'id, title, tags, created_at, updated_at, indexed_at, indexing_error, document_chunks(count)';
const FULL_COLUMNS = `content, ${SUMMARY_COLUMNS}`;

/**
 * Document CRUD.
 *
 * Every query runs through the request-scoped client, which carries the
 * caller's access token, so row-level security scopes each statement to its
 * owner. That is why no method below filters on `user_id`: doing so would
 * duplicate the policy and imply the database was not already enforcing it.
 * The one exception is `create`, where `user_id` is a value being written
 * rather than a filter — and the insert policy's `with check` verifies it.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly supabase: SupabaseUserClient,
    private readonly indexing: IndexingService,
  ) {}

  async list({
    limit,
    offset,
    tag,
  }: ListDocumentsQuery): Promise<DocumentList> {
    let query = this.supabase.db
      .from('documents')
      .select(SUMMARY_COLUMNS, { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (tag) {
      // Array containment, which the GIN index on `tags` serves.
      query = query.contains('tags', [tag]);
    }

    const { data, error, count } = await query;

    if (error) {
      throwPostgrestError(error, 'document');
    }

    return {
      documents: data.map((row) => toDocumentSummary(row)),
      total: count ?? data.length,
    };
  }

  async findOne(id: string): Promise<Document> {
    const { data, error } = await this.supabase.db
      .from('documents')
      .select(FULL_COLUMNS)
      .eq('id', id)
      .single();

    if (error) {
      throwPostgrestError(error, 'document');
    }

    return toDocument(data);
  }

  /**
   * Creates the document, then embeds it.
   *
   * The write is committed before indexing starts, so a provider outage costs
   * the user their embeddings rather than their text. The outcome comes back
   * on the response so the client can say so instead of quietly showing a
   * document that no answer will ever cite.
   */
  async create(userId: string, input: CreateDocument): Promise<Document> {
    const { data, error } = await this.supabase.db
      .from('documents')
      .insert({
        user_id: userId,
        title: input.title,
        content: input.content,
        tags: input.tags,
      })
      .select(FULL_COLUMNS)
      .single();

    if (error) {
      throwPostgrestError(error, 'document');
    }

    const outcome = await this.indexing.indexDocument(data.id, input.content);

    return toDocument(data, outcome);
  }

  async update(id: string, input: UpdateDocument): Promise<Document> {
    // `user_id` is deliberately absent: the caller cannot reassign ownership,
    // and `updated_at` is maintained by a trigger rather than by this code.
    const { data, error } = await this.supabase.db
      .from('documents')
      .update({
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.content === undefined ? {} : { content: input.content }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
      })
      .eq('id', id)
      .select(FULL_COLUMNS)
      .single();

    if (error) {
      throwPostgrestError(error, 'document');
    }

    // Retitling or retagging does not change what the text means, so only a
    // content edit is worth the cost of re-embedding. A trigger has already
    // cleared the indexing state, so the row is correctly marked stale either
    // way.
    if (input.content === undefined) {
      return toDocument(data);
    }

    return toDocument(
      data,
      await this.indexing.indexDocument(id, data.content),
    );
  }

  /** Retries indexing for a document whose last attempt failed. */
  async reindex(id: string): Promise<Document> {
    const document = await this.findOne(id);
    const outcome = await this.indexing.indexDocument(id, document.content);

    return { ...document, indexing: toIndexing(document, outcome) };
  }

  async remove(id: string): Promise<void> {
    // Selecting the deleted row turns "not mine" and "not there" into the
    // same 404 instead of a silent success. Chunks go with it by cascade.
    const { error } = await this.supabase.db
      .from('documents')
      .delete()
      .eq('id', id)
      .select('id')
      .single();

    if (error) {
      throwPostgrestError(error, 'document');
    }
  }
}

type SummaryRow = Pick<
  DocumentRow,
  | 'id'
  | 'title'
  | 'tags'
  | 'created_at'
  | 'updated_at'
  | 'indexed_at'
  | 'indexing_error'
> & {
  /** PostgREST returns an embedded aggregate as a one-element array. */
  document_chunks?: { count: number }[] | null;
};

function toDocumentSummary(
  row: SummaryRow,
  outcome?: IndexingOutcome,
): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    indexing: toIndexing(row, outcome),
  };
}

function toDocument(
  row: SummaryRow & Pick<DocumentRow, 'content'>,
  outcome?: IndexingOutcome,
): Document {
  return { ...toDocumentSummary(row, outcome), content: row.content };
}

/**
 * Derives the indexing state the client sees.
 *
 * When an indexing attempt just ran, its result is authoritative: it describes
 * writes this request made, and re-reading the row to learn what we just wrote
 * would only add a round trip.
 */
function toIndexing(
  row: {
    indexed_at?: string | null;
    indexing_error?: string | null;
    document_chunks?: { count: number }[] | null;
    indexing?: DocumentIndexing;
  },
  outcome?: IndexingOutcome,
): DocumentIndexing {
  const chunkCount =
    row.document_chunks?.[0]?.count ?? row.indexing?.chunkCount ?? null;

  if (outcome?.status === 'indexed') {
    return {
      status: 'indexed',
      indexedAt: new Date().toISOString(),
      error: null,
      chunkCount: outcome.chunkCount,
    };
  }

  if (outcome?.status === 'failed') {
    return {
      status: 'failed',
      indexedAt: null,
      error: outcome.reason,
      chunkCount,
    };
  }

  const indexedAt = row.indexed_at ?? row.indexing?.indexedAt ?? null;
  const error = row.indexing_error ?? row.indexing?.error ?? null;

  return {
    status:
      error !== null ? 'failed' : indexedAt !== null ? 'indexed' : 'pending',
    indexedAt,
    error,
    chunkCount,
  };
}
