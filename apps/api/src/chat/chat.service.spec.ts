import { describe, expect, it, jest } from '@jest/globals';
import type { ConversationMessage } from '@repo/contracts';

import type { ChatModel } from '../ai/chat-model';
import type { SupabaseUserClient } from '../supabase/supabase-user-client';

import { ChatService } from './chat.service';
import type { ConversationsService } from './conversations.service';
import type { RetrievalService, RetrievedChunk } from './retrieval.service';

const CONVERSATION_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

const CHUNK: RetrievedChunk = {
  chunkId: 'chunk-1',
  documentId: 'doc-1',
  documentTitle: 'Cell biology',
  content: 'Mitochondria make ATP.',
  similarity: 0.8,
};

function message(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: 'm1',
    role: 'user',
    content: 'q',
    createdAt: '2026-09-20T10:00:00+00:00',
    model: null,
    usage: null,
    citations: [],
    ...overrides,
  };
}

interface HarnessOptions {
  history?: ConversationMessage[];
  chunks?: RetrievedChunk[];
  deltas?: string[];
}

function harness({
  history = [],
  chunks = [CHUNK],
  deltas = ['Mito', 'chondria.'],
}: HarnessOptions = {}) {
  const calls: string[] = [];
  const appended: Array<Record<string, unknown>> = [];
  let titled: string | null = null;

  const model = {
    model: 'stub-chat',
    complete: jest.fn(async () => {
      calls.push('model.complete');
      return {
        content: 'Mitochondria make ATP [1].',
        model: 'stub-chat-2026',
        finishReason: 'stop' as const,
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      };
    }),
    stream: jest.fn(async function* () {
      calls.push('model.stream');
      for (const text of deltas) {
        yield { type: 'delta' as const, text };
      }
      yield {
        type: 'done' as const,
        completion: {
          content: deltas.join(''),
          model: 'stub-chat-2026',
          finishReason: 'stop' as const,
          usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        },
      };
    }),
  } as unknown as ChatModel;

  const retrievalCalls: Array<[string, unknown]> = [];
  const retrieval = {
    retrieve: jest.fn(async (question: string, options: unknown) => {
      calls.push('retrieval');
      retrievalCalls.push([question, options]);
      return chunks;
    }),
  } as unknown as RetrievalService;

  const conversations = {
    findOne: jest.fn(async () => {
      calls.push('conversations.findOne');
      return {
        id: CONVERSATION_ID,
        title: 'New conversation',
        createdAt: 'x',
        updatedAt: 'y',
      };
    }),
    messages: jest.fn(async () => history),
    appendUserMessage: jest.fn(async (_id: string, _u: string, content: string) => {
      calls.push('append.user');
      appended.push({ role: 'user', content });
      return message({ id: 'user-msg', content });
    }),
    appendAssistantMessage: jest.fn(
      async (_id: string, _u: string, answer: Record<string, unknown>) => {
        calls.push('append.assistant');
        appended.push({ role: 'assistant', ...answer });
        return message({
          id: 'assistant-msg',
          role: 'assistant',
          content: answer.content as string,
          model: answer.model as string,
        });
      },
    ),
    titleFromFirstQuestion: jest.fn(async (_id: string, q: string) => {
      titled = q;
    }),
  } as unknown as ConversationsService;

  const supabase = { userId: USER_ID } as unknown as SupabaseUserClient;

  return {
    calls,
    appended,
    retrievalCalls,
    get titled() {
      return titled;
    },
    conversations,
    service: new ChatService(model, retrieval, conversations, supabase),
  };
}

describe('ChatService.ask', () => {
  it('returns the question and the answer as persisted turns', async () => {
    const { service } = harness();

    const answer = await service.ask(CONVERSATION_ID, { question: 'How?' });

    expect(answer.userMessage.content).toBe('How?');
    expect(answer.assistantMessage.content).toBe('Mitochondria make ATP [1].');
  });

  // Nothing should be written, and no provider billed, for a bad id.
  it('checks the conversation exists before retrieving or answering', async () => {
    const { service, calls } = harness();

    await service.ask(CONVERSATION_ID, { question: 'How?' });

    expect(calls[0]).toBe('conversations.findOne');
    expect(calls.indexOf('conversations.findOne')).toBeLessThan(
      calls.indexOf('model.complete'),
    );
  });

  it('retrieves before calling the model', async () => {
    const { service, calls } = harness();

    await service.ask(CONVERSATION_ID, { question: 'How?' });

    expect(calls.indexOf('retrieval')).toBeLessThan(
      calls.indexOf('model.complete'),
    );
  });

  it('stores the answer with the sources that produced it', async () => {
    const { service, appended } = harness();

    await service.ask(CONVERSATION_ID, { question: 'How?' });

    const assistant = appended.find((a) => a.role === 'assistant');

    expect(assistant?.chunks).toEqual([CHUNK]);
    expect(assistant?.usage).toMatchObject({ totalTokens: 120 });
  });

  it('records the model that actually answered', async () => {
    const { service, appended } = harness();

    await service.ask(CONVERSATION_ID, { question: 'How?' });

    expect(appended.find((a) => a.role === 'assistant')?.model).toBe(
      'stub-chat-2026',
    );
  });

  it('names a new conversation after its first question', async () => {
    const h = harness({ history: [] });

    await h.service.ask(CONVERSATION_ID, { question: 'How do cells work?' });

    expect(h.titled).toBe('How do cells work?');
  });

  it('leaves an ongoing conversation titled as it was', async () => {
    const h = harness({ history: [message()] });

    await h.service.ask(CONVERSATION_ID, { question: 'Follow up?' });

    expect(h.titled).toBeNull();
  });

  it('passes recent turns to retrieval so follow-ups resolve', async () => {
    const { service, retrievalCalls } = harness({
      history: [message({ content: 'What makes ATP?' })],
    });

    await service.ask(CONVERSATION_ID, { question: 'Why?' });

    expect(retrievalCalls[0]?.[1]).toMatchObject({
      history: ['What makes ATP?'],
    });
  });

  it('forwards a document filter to retrieval', async () => {
    const { service, retrievalCalls } = harness();

    await service.ask(CONVERSATION_ID, {
      question: 'How?',
      documentIds: ['doc-9'],
    });

    expect(retrievalCalls[0]?.[1]).toMatchObject({ documentIds: ['doc-9'] });
  });

  it('still answers when nothing was retrieved', async () => {
    const { service, appended } = harness({ chunks: [] });

    const answer = await service.ask(CONVERSATION_ID, { question: 'How?' });

    expect(answer.assistantMessage.content).toBeTruthy();
    expect(appended.find((a) => a.role === 'assistant')?.chunks).toEqual([]);
  });
});

describe('ChatService.askStreaming', () => {
  async function drain(stream: AsyncIterable<unknown>) {
    const events: Record<string, unknown>[] = [];

    for await (const event of stream) {
      events.push(event as Record<string, unknown>);
    }

    return events;
  }

  // Retrieval finishes before the first token, so the sources can be on screen
  // while the answer types out.
  it('emits citations before any text', async () => {
    const { service } = harness();

    const events = await drain(
      service.askStreaming(CONVERSATION_ID, { question: 'How?' }),
    );

    expect(events[0]?.type).toBe('citations');
    expect(events[0]?.citations).toHaveLength(1);
  });

  it('emits each delta, then a final persisted message', async () => {
    const { service } = harness({ deltas: ['Mito', 'chondria', '.'] });

    const events = await drain(
      service.askStreaming(CONVERSATION_ID, { question: 'How?' }),
    );

    expect(events.filter((e) => e.type === 'delta').map((e) => e.text)).toEqual([
      'Mito',
      'chondria',
      '.',
    ]);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('persists the assembled answer, not the individual deltas', async () => {
    const { service, appended } = harness({ deltas: ['a', 'b', 'c'] });

    await drain(service.askStreaming(CONVERSATION_ID, { question: 'How?' }));

    const assistant = appended.filter((a) => a.role === 'assistant');

    expect(assistant).toHaveLength(1);
    expect(assistant[0]?.content).toBe('abc');
  });

  it('records usage from the stream just as the plain path does', async () => {
    const { service, appended } = harness();

    await drain(service.askStreaming(CONVERSATION_ID, { question: 'How?' }));

    expect(appended.find((a) => a.role === 'assistant')?.usage).toMatchObject({
      totalTokens: 120,
    });
  });

  it('writes the question before streaming starts', async () => {
    const { service, calls } = harness();

    await drain(service.askStreaming(CONVERSATION_ID, { question: 'How?' }));

    expect(calls.indexOf('append.user')).toBeLessThan(
      calls.indexOf('model.stream'),
    );
  });
});
