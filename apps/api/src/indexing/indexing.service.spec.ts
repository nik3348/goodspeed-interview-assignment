import { describe, expect, it, jest } from '@jest/globals';

import { AiRateLimitError } from '../ai/ai.errors';
import type { EmbeddingModel } from '../ai/embedding-model';
import type { SupabaseUserClient } from '../supabase/supabase-user-client';

import { IndexingService } from './indexing.service';

const DIMENSIONS = 3;
const USER_ID = '00000000-0000-0000-0000-0000000000aa';
const DOCUMENT_ID = '3f6a1c9e-1111-4a7b-9c2d-000000000001';

interface Operation {
  table: string;
  verb: string;
  payload?: unknown;
}

/**
 * Records the sequence of database operations, which is what the interesting
 * assertions are about: whether the old chunks survive a provider failure.
 */
function fakeDb(errors: Record<string, { message: string }> = {}) {
  const operations: Operation[] = [];

  const from = (table: string) => {
    const record = (verb: string, payload?: unknown) => {
      operations.push({ table, verb, payload });

      const builder = {
        eq: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(
            resolve({ error: errors[`${table}.${verb}`] ?? null }),
          ),
      };

      return builder;
    };

    return {
      delete: () => record('delete'),
      insert: (rows: unknown) => record('insert', rows),
      update: (values: unknown) => record('update', values),
    };
  };

  return { operations, client: { db: { from }, userId: USER_ID } };
}

/**
 * Logs into the same timeline as the database stub, so a test can assert on
 * the order of provider calls relative to writes rather than just that both
 * happened.
 */
function fakeEmbeddings(
  behaviour: 'ok' | Error = 'ok',
  timeline: Operation[] = [],
): EmbeddingModel & { calls: string[][] } {
  const calls: string[][] = [];

  return {
    model: 'text-embedding-3-small',
    dimensions: DIMENSIONS,
    maxBatchSize: 96,
    calls,
    embed: jest.fn(async ({ inputs }: { inputs: string[] }) => {
      calls.push(inputs);
      timeline.push({ table: 'provider', verb: 'embed' });

      if (behaviour !== 'ok') {
        throw behaviour;
      }

      return {
        embeddings: inputs.map((_, i) => [i, i + 1, i + 2]),
        usage: { promptTokens: 5, completionTokens: 0, totalTokens: 5 },
      };
    }),
  } as unknown as EmbeddingModel & { calls: string[][] };
}

function service(
  db: ReturnType<typeof fakeDb>,
  embeddings: EmbeddingModel,
): IndexingService {
  return new IndexingService(
    embeddings,
    db.client as unknown as SupabaseUserClient,
  );
}

const CONTENT = [
  '# Cell biology',
  'The mitochondrion is the powerhouse of the cell. It makes ATP.',
  'Chloroplasts perform photosynthesis in plant cells.',
].join('\n\n');

describe('IndexingService', () => {
  it('embeds the document and stores a row per chunk', async () => {
    const db = fakeDb();
    const embeddings = fakeEmbeddings();

    const outcome = await service(db, embeddings).indexDocument(
      DOCUMENT_ID,
      CONTENT,
    );

    expect(outcome).toMatchObject({ status: 'indexed' });

    const insert = db.operations.find((op) => op.verb === 'insert');
    const rows = insert?.payload as Record<string, unknown>[];

    expect(rows).toHaveLength(embeddings.calls[0]?.length ?? 0);
    expect(rows[0]).toMatchObject({
      document_id: DOCUMENT_ID,
      user_id: USER_ID,
      chunk_index: 0,
      embedding_model: 'text-embedding-3-small',
    });
  });

  it('numbers chunks in order and records a token estimate', async () => {
    const db = fakeDb();

    await service(db, fakeEmbeddings()).indexDocument(DOCUMENT_ID, CONTENT);

    const rows = db.operations.find((op) => op.verb === 'insert')
      ?.payload as Record<string, unknown>[];

    expect(rows.map((row) => row.chunk_index)).toEqual(
      rows.map((_, index) => index),
    );
    for (const row of rows) {
      expect(row.token_count).toBeGreaterThan(0);
    }
  });

  it('serialises the vector the way PostgREST expects', async () => {
    const db = fakeDb();

    await service(db, fakeEmbeddings()).indexDocument(DOCUMENT_ID, CONTENT);

    const rows = db.operations.find((op) => op.verb === 'insert')
      ?.payload as Record<string, unknown>[];

    expect(rows[0]?.embedding).toBe(JSON.stringify([0, 1, 2]));
  });

  // The ordering that matters: a provider outage must not empty the index.
  it('embeds before deleting the existing chunks', async () => {
    const db = fakeDb();
    const embeddings = fakeEmbeddings('ok', db.operations);

    await service(db, embeddings).indexDocument(DOCUMENT_ID, CONTENT);

    expect(db.operations.map((op) => `${op.table}.${op.verb}`)).toEqual([
      'provider.embed',
      'document_chunks.delete',
      'document_chunks.insert',
      'documents.update',
    ]);
  });

  it('leaves the previous chunks in place when embedding fails', async () => {
    const db = fakeDb();

    const outcome = await service(
      db,
      fakeEmbeddings(new AiRateLimitError(null), db.operations),
    ).indexDocument(DOCUMENT_ID, CONTENT);

    expect(outcome).toMatchObject({ status: 'failed' });
    // The only write is the one recording why it failed.
    expect(db.operations.map((op) => `${op.table}.${op.verb}`)).toEqual([
      'provider.embed',
      'documents.update',
    ]);
  });

  it('records the reason on the document when embedding fails', async () => {
    const db = fakeDb();

    await service(db, fakeEmbeddings(new AiRateLimitError(null))).indexDocument(
      DOCUMENT_ID,
      CONTENT,
    );

    const update = db.operations.find((op) => op.table === 'documents');

    expect(update?.payload).toMatchObject({ indexed_at: null });
    expect(
      (update?.payload as { indexing_error: string }).indexing_error,
    ).toContain('rate limiting');
  });

  it('marks the document indexed and clears any earlier error', async () => {
    const db = fakeDb();

    await service(db, fakeEmbeddings()).indexDocument(DOCUMENT_ID, CONTENT);

    const update = db.operations.find((op) => op.table === 'documents');

    expect(update?.payload).toMatchObject({ indexing_error: null });
    expect((update?.payload as { indexed_at: string }).indexed_at).toBeTruthy();
  });

  it('reports usage so the cost of a write can be attributed', async () => {
    const db = fakeDb();

    const outcome = await service(db, fakeEmbeddings()).indexDocument(
      DOCUMENT_ID,
      CONTENT,
    );

    expect(outcome).toMatchObject({
      status: 'indexed',
      usage: { totalTokens: 5 },
    });
  });

  it('does not throw when the database rejects the insert', async () => {
    const db = fakeDb({ 'document_chunks.insert': { message: 'nope' } });

    const outcome = await service(db, fakeEmbeddings()).indexDocument(
      DOCUMENT_ID,
      CONTENT,
    );

    expect(outcome).toMatchObject({ status: 'failed' });
  });

  it('still clears the index for a document emptied of content', async () => {
    const db = fakeDb();

    const outcome = await service(db, fakeEmbeddings()).indexDocument(
      DOCUMENT_ID,
      '   ',
    );

    expect(outcome).toMatchObject({ status: 'indexed', chunkCount: 0 });
    expect(db.operations.some((op) => op.verb === 'delete')).toBe(true);
    expect(db.operations.some((op) => op.verb === 'insert')).toBe(false);
  });
});
