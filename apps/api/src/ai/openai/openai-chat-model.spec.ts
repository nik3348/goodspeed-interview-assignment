import { describe, expect, it, jest } from '@jest/globals';
import type OpenAI from 'openai';

import type { ChatCompletion, ChatStreamEvent } from '../messages';

import { OpenAiChatModel } from './openai-chat-model';

function fakeClient(respond: (body: Record<string, unknown>) => unknown) {
  const requests: Array<Record<string, unknown>> = [];

  const create = jest.fn(async (body: Record<string, unknown>) => {
    requests.push(body);
    return respond(body);
  });

  return {
    requests,
    client: { chat: { completions: { create } } } as unknown as OpenAI,
  };
}

function completion(overrides: Record<string, unknown> = {}) {
  return {
    model: 'gpt-4o-mini',
    choices: [{ message: { content: 'Hello.' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    ...overrides,
  };
}

async function* chunks(...items: unknown[]) {
  for (const item of items) {
    yield item;
  }
}

async function collect(
  stream: AsyncIterable<ChatStreamEvent>,
): Promise<{ deltas: string[]; completion: ChatCompletion | null }> {
  const deltas: string[] = [];
  let final: ChatCompletion | null = null;

  for await (const event of stream) {
    if (event.type === 'delta') {
      deltas.push(event.text);
    } else {
      final = event.completion;
    }
  }

  return { deltas, completion: final };
}

const model = (client: OpenAI) => new OpenAiChatModel(client, 'gpt-4o-mini');

describe('OpenAiChatModel.complete', () => {
  it('returns the message content and normalised usage', async () => {
    const { client } = fakeClient(() => completion());

    await expect(
      model(client).complete({ messages: [{ role: 'user', content: 'Hi' }] }),
    ).resolves.toEqual({
      content: 'Hello.',
      model: 'gpt-4o-mini',
      finishReason: 'stop',
      usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
    });
  });

  it('reports the model that actually answered, not the one requested', async () => {
    const { client } = fakeClient(() =>
      completion({ model: 'gpt-4o-mini-2024-07-18' }),
    );

    const result = await model(client).complete({
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.model).toBe('gpt-4o-mini-2024-07-18');
  });

  it.each([
    ['stop', 'stop'],
    ['length', 'length'],
    ['content_filter', 'content_filter'],
    ['tool_calls', 'other'],
    [null, 'other'],
  ])('normalises finish reason %s to %s', async (given, expected) => {
    const { client } = fakeClient(() =>
      completion({
        choices: [{ message: { content: 'x' }, finish_reason: given }],
      }),
    );

    const result = await model(client).complete({ messages: [] });

    expect(result.finishReason).toBe(expected);
  });

  it('copes with a provider that reports no usage', async () => {
    const { client } = fakeClient(() => completion({ usage: undefined }));

    const result = await model(client).complete({ messages: [] });

    expect(result.usage).toBeNull();
  });

  it('copes with a provider that returns no choices', async () => {
    const { client } = fakeClient(() => completion({ choices: [] }));

    await expect(model(client).complete({ messages: [] })).resolves.toMatchObject(
      { content: '', finishReason: 'other' },
    );
  });

  it('omits optional parameters the caller did not set', async () => {
    const { client, requests } = fakeClient(() => completion());

    await model(client).complete({ messages: [] });

    expect(requests[0]).not.toHaveProperty('temperature');
    expect(requests[0]).not.toHaveProperty('max_tokens');
  });

  it('passes through the sampling controls the caller did set', async () => {
    const { client, requests } = fakeClient(() => completion());

    await model(client).complete({
      messages: [],
      temperature: 0,
      maxOutputTokens: 512,
    });

    expect(requests[0]).toMatchObject({ temperature: 0, max_tokens: 512 });
  });
});

describe('OpenAiChatModel.stream', () => {
  it('yields deltas and then one assembled completion', async () => {
    const { client } = fakeClient(() =>
      chunks(
        { model: 'gpt-4o-mini', choices: [{ delta: { content: 'Hel' } }] },
        { model: 'gpt-4o-mini', choices: [{ delta: { content: 'lo.' } }] },
        {
          model: 'gpt-4o-mini',
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        },
      ),
    );

    const { deltas, completion: final } = await collect(
      model(client).stream({ messages: [{ role: 'user', content: 'Hi' }] }),
    );

    expect(deltas).toEqual(['Hel', 'lo.']);
    expect(final).toEqual({
      content: 'Hello.',
      model: 'gpt-4o-mini',
      finishReason: 'stop',
      usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
    });
  });

  it('asks for usage on the final chunk', async () => {
    const { client, requests } = fakeClient(() => chunks());

    await collect(model(client).stream({ messages: [] }));

    expect(requests[0]).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it('still ends with a completion when the provider omits usage', async () => {
    const { client } = fakeClient(() =>
      chunks({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }),
    );

    const { completion: final } = await collect(
      model(client).stream({ messages: [] }),
    );

    expect(final).toMatchObject({ content: 'hi', usage: null });
  });

  it('skips empty deltas rather than emitting blank events', async () => {
    const { client } = fakeClient(() =>
      chunks(
        { choices: [{ delta: {} }] },
        { choices: [{ delta: { content: '' } }] },
        { choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] },
      ),
    );

    const { deltas } = await collect(model(client).stream({ messages: [] }));

    expect(deltas).toEqual(['x']);
  });
});
