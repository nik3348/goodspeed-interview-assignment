import { Injectable } from '@nestjs/common';
import type {
  CreateDocument,
  Document,
  DocumentList,
  DocumentSummary,
  ListDocumentsQuery,
  UpdateDocument,
} from '@repo/contracts';
import type { DocumentRow } from '@repo/database';

import { throwPostgrestError } from '../supabase/postgrest-error';
import { SupabaseUserClient } from '../supabase/supabase-user-client';

/** Columns a list view needs. Bodies can be large, so they are left behind. */
const SUMMARY_COLUMNS = 'id, title, tags, created_at, updated_at';
const FULL_COLUMNS = 'id, title, content, tags, created_at, updated_at';

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
  constructor(private readonly supabase: SupabaseUserClient) {}

  async list({ limit, offset, tag }: ListDocumentsQuery): Promise<DocumentList> {
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
      documents: data.map(toDocumentSummary),
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

    return toDocument(data);
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

    return toDocument(data);
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
  'id' | 'title' | 'tags' | 'created_at' | 'updated_at'
>;

function toDocumentSummary(row: SummaryRow): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDocument(row: SummaryRow & Pick<DocumentRow, 'content'>): Document {
  return { ...toDocumentSummary(row), content: row.content };
}
