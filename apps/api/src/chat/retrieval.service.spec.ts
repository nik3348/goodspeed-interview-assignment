import { describe, expect, it, jest } from '@jest/globals';

import type { EmbeddingModel } from '../ai/embedding-model';
import type { SupabaseUserClient } from '../supabase/supabase-user-client';

import { RetrievalService } from './retrieval.service';

const ROW = {
  id: 'chunk-1',
  document_id: 'doc-1',
  document_title: 'Cell biology',
  chunk_index: 0,
  content: 'Mitochondria make ATP.',
  similarity: 0.83,
};

function harness(rows: unknown[] = [ROW]) {
  const embedded: string[][] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const embeddings = {
    model: 'stub-embed',
    dimensions: 3,
    maxBatchSize: 96,
    embed: jest.fn(async ({ inputs }: { inputs: string[] }) => {
      embedded.push(inputs);
      return { embeddings: inputs.map(() => [0.1, 0.2, 0.3]), usage: null };
    }),
  } as unknown as EmbeddingModel;

  const supabase = {
    userId: 'user-1',
    db: {
      rpc: jest.fn(async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return { data: rows, error: null };
      }),
    },
  } as unknown as SupabaseUserClient;

  return {
    embedded,
    rpcCalls,
    service: new RetrievalService(embeddings, supabase),
  };
}

describe('RetrievalService', () => {
  it('maps matched rows into the retrieval shape', async () => {
    const { service } = harness();

    await expect(
      service.retrieve('How do cells make energy?'),
    ).resolves.toEqual([
      {
        chunkId: 'chunk-1',
        documentId: 'doc-1',
        documentTitle: 'Cell biology',
        content: 'Mitochondria make ATP.',
        similarity: 0.83,
      },
    ]);
  });

  it('embeds the question', async () => {
    const { service, embedded } = harness();

    await service.retrieve('How do cells make energy?');

    expect(embedded).toEqual([['How do cells make energy?']]);
  });

  // "Why is that?" embeds to nothing useful alone, so the subject is carried
  // forward from the preceding turns.
  it('folds recent history into the search text', async () => {
    const { service, embedded } = harness();

    await service.retrieve('And why is that?', {
      history: ['What makes ATP?', 'Mitochondria do.'],
    });

    const text = embedded[0]?.[0] ?? '';

    expect(text).toContain('What makes ATP?');
    expect(text).toContain('And why is that?');
  });

  it('puts the question last so it dominates the vector', async () => {
    const { service, embedded } = harness();

    await service.retrieve('And why is that?', {
      history: ['What makes ATP?'],
    });

    expect(
      (embedded[0]?.[0] ?? '').trimEnd().endsWith('And why is that?'),
    ).toBe(true);
  });

  it('ignores history older than the last couple of turns', async () => {
    const { service, embedded } = harness();

    await service.retrieve('q', {
      history: ['ancient', 'older', 'recent one', 'recent two'],
    });

    expect(embedded[0]?.[0]).not.toContain('ancient');
    expect(embedded[0]?.[0]).toContain('recent two');
  });

  it('searches through the SQL function, not a hand-built query', async () => {
    const { service, rpcCalls } = harness();

    await service.retrieve('q');

    expect(rpcCalls[0]?.name).toBe('match_document_chunks');
  });

  // RLS decides whose chunks are searched; passing a user id would be both
  // redundant and a way to get it wrong.
  it('never passes a user id to the search', async () => {
    const { service, rpcCalls } = harness();

    await service.retrieve('q');

    expect(JSON.stringify(rpcCalls[0]?.args)).not.toContain('user');
  });

  it('serialises the query vector the way PostgREST expects', async () => {
    const { service, rpcCalls } = harness();

    await service.retrieve('q');

    expect(rpcCalls[0]?.args.query_embedding).toBe(
      JSON.stringify([0.1, 0.2, 0.3]),
    );
  });

  it('scopes the search when the caller names documents', async () => {
    const { service, rpcCalls } = harness();

    await service.retrieve('q', { documentIds: ['doc-1', 'doc-2'] });

    expect(rpcCalls[0]?.args.filter_document_ids).toEqual(['doc-1', 'doc-2']);
  });

  it('omits the filter entirely when no documents are named', async () => {
    const { service, rpcCalls } = harness();

    await service.retrieve('q');

    expect(rpcCalls[0]?.args).not.toHaveProperty('filter_document_ids');
  });

  it('honours caller-supplied limit and threshold', async () => {
    const { service, rpcCalls } = harness();

    await service.retrieve('q', { limit: 3, minSimilarity: 0.5 });

    expect(rpcCalls[0]?.args).toMatchObject({
      match_count: 3,
      match_threshold: 0.5,
    });
  });

  it('returns nothing when the knowledge base has no match', async () => {
    const { service } = harness([]);

    await expect(service.retrieve('q')).resolves.toEqual([]);
  });
});
