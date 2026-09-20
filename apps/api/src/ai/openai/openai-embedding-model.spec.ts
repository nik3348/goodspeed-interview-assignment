import { describe, expect, it, jest } from '@jest/globals';
import type OpenAI from 'openai';

import { AiConfigurationError } from '../ai.errors';

import { OpenAiEmbeddingModel } from './openai-embedding-model';

const DIMENSIONS = 4;

function vector(seed: number): number[] {
  return Array.from({ length: DIMENSIONS }, (_, i) => seed + i / 10);
}

/** A stand-in for `client.embeddings`, recording the requests it receives. */
function fakeClient(
  respond: (input: string[]) => { index: number; embedding: number[] }[],
) {
  const requests: Array<Record<string, unknown>> = [];

  const create = jest.fn(async (body: Record<string, unknown>) => {
    requests.push(body);

    return {
      data: respond(body.input as string[]),
      usage: { prompt_tokens: 10, total_tokens: 10 },
    };
  });

  return {
    requests,
    client: { embeddings: { create } } as unknown as OpenAI,
  };
}

function inOrder(input: string[]) {
  return input.map((_, index) => ({ index, embedding: vector(index) }));
}

function model(
  client: OpenAI,
  { batchSize = 10, requestDimensions = false } = {},
) {
  return new OpenAiEmbeddingModel(
    client,
    'text-embedding-3-small',
    DIMENSIONS,
    batchSize,
    requestDimensions,
  );
}

describe('OpenAiEmbeddingModel', () => {
  it('returns one vector per input', async () => {
    const { client } = fakeClient(inOrder);

    const result = await model(client).embed({ inputs: ['a', 'b', 'c'] });

    expect(result.embeddings).toHaveLength(3);
    expect(result.embeddings[0]).toEqual(vector(0));
  });

  it('makes no request at all for an empty batch', async () => {
    const { client, requests } = fakeClient(inOrder);

    await expect(model(client).embed({ inputs: [] })).resolves.toEqual({
      embeddings: [],
      usage: null,
    });
    expect(requests).toHaveLength(0);
  });

  it('splits work into requests the provider will accept', async () => {
    const { client, requests } = fakeClient(inOrder);
    const inputs = Array.from({ length: 7 }, (_, i) => `chunk ${i}`);

    const result = await model(client, { batchSize: 3 }).embed({ inputs });

    expect(requests.map((r) => (r.input as string[]).length)).toEqual([3, 3, 1]);
    expect(result.embeddings).toHaveLength(7);
  });

  it('sums usage across the requests a batch was split into', async () => {
    const { client } = fakeClient(inOrder);
    const inputs = Array.from({ length: 7 }, (_, i) => `chunk ${i}`);

    const result = await model(client, { batchSize: 3 }).embed({ inputs });

    // Three requests at 10 tokens each.
    expect(result.usage?.totalTokens).toBe(30);
  });

  // The API documents ordered results but also returns an explicit index;
  // trusting the index costs nothing and removes a silent-corruption risk.
  it('restores input order when the provider returns results shuffled', async () => {
    const { client } = fakeClient((input) =>
      input.map((_, index) => ({ index, embedding: vector(index) })).reverse(),
    );

    const result = await model(client).embed({ inputs: ['a', 'b', 'c'] });

    expect(result.embeddings).toEqual([vector(0), vector(1), vector(2)]);
  });

  it('rejects vectors that would not fit the database column', async () => {
    const { client } = fakeClient((input) =>
      input.map((_, index) => ({ index, embedding: [0.1, 0.2] })),
    );

    await expect(model(client).embed({ inputs: ['a'] })).rejects.toBeInstanceOf(
      AiConfigurationError,
    );
  });

  it('explains a dimension mismatch in terms of the fix', async () => {
    const { client } = fakeClient((input) =>
      input.map((_, index) => ({ index, embedding: [0.1, 0.2] })),
    );

    await expect(model(client).embed({ inputs: ['a'] })).rejects.toThrow(
      /AI_EMBEDDING_DIMENSIONS|migrate/,
    );
  });

  it('notices when the provider drops an input', async () => {
    const { client } = fakeClient(() => [{ index: 0, embedding: vector(0) }]);

    await expect(
      model(client).embed({ inputs: ['a', 'b'] }),
    ).rejects.toBeInstanceOf(AiConfigurationError);
  });

  it('omits the dimensions parameter unless it was configured', async () => {
    const { client, requests } = fakeClient(inOrder);

    await model(client).embed({ inputs: ['a'] });

    expect(requests[0]).not.toHaveProperty('dimensions');
  });

  it('sends dimensions when the deployment asked for a specific width', async () => {
    const { client, requests } = fakeClient(inOrder);

    await model(client, { requestDimensions: true }).embed({ inputs: ['a'] });

    expect(requests[0]).toMatchObject({ dimensions: DIMENSIONS });
  });
});
