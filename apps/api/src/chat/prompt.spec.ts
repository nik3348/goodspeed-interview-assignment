import { describe, expect, it } from '@jest/globals';

import type { RetrievedChunk } from './retrieval.service';

import { buildPrompt } from './prompt';

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: 'c1',
    documentId: 'd1',
    documentTitle: 'Cell biology',
    content: 'Mitochondria make ATP.',
    similarity: 0.8,
    ...overrides,
  };
}

const system = (prompt: ReturnType<typeof buildPrompt>) =>
  prompt.messages[0]?.content ?? '';

describe('buildPrompt', () => {
  it('leads with a system message and ends with the question', () => {
    const prompt = buildPrompt({
      question: 'How do cells make energy?',
      chunks: [chunk()],
      history: [],
    });

    expect(prompt.messages[0]?.role).toBe('system');
    expect(prompt.messages.at(-1)).toEqual({
      role: 'user',
      content: 'How do cells make energy?',
    });
  });

  it('numbers sources so a citation marker resolves', () => {
    const prompt = buildPrompt({
      question: 'q',
      chunks: [
        chunk({ documentTitle: 'First' }),
        chunk({ documentTitle: 'Second' }),
      ],
      history: [],
    });

    expect(system(prompt)).toContain('[1] First');
    expect(system(prompt)).toContain('[2] Second');
  });

  it('instructs the model to refuse rather than guess', () => {
    const prompt = buildPrompt({
      question: 'q',
      chunks: [chunk()],
      history: [],
    });

    expect(system(prompt).toLowerCase()).toContain('do not guess');
  });

  // An empty knowledge base must not silently become a general-purpose chatbot.
  it('says plainly when nothing was retrieved', () => {
    const prompt = buildPrompt({ question: 'q', chunks: [], history: [] });

    expect(system(prompt)).toContain('none');
    expect(prompt.citedChunks).toEqual([]);
  });

  it('carries prior turns between the sources and the question', () => {
    const prompt = buildPrompt({
      question: 'And why is that?',
      chunks: [chunk()],
      history: [
        { role: 'user', content: 'What makes ATP?' },
        { role: 'assistant', content: 'Mitochondria do.' },
      ],
    });

    expect(prompt.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
  });

  // Context is rebuilt per question; letting history grow without bound would
  // eventually exceed the window mid-conversation.
  it('keeps only the most recent turns', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${i}`,
    }));

    const prompt = buildPrompt({ question: 'q', chunks: [], history });

    expect(prompt.messages.length).toBeLessThan(12);
    expect(JSON.stringify(prompt.messages)).toContain('turn 29');
    expect(JSON.stringify(prompt.messages)).not.toContain('turn 0');
  });

  it('stops adding sources once the budget is spent', () => {
    const big = chunk({ content: 'x'.repeat(3_000) });

    const prompt = buildPrompt({
      question: 'q',
      chunks: [big, big, big, big, big],
      history: [],
    });

    expect(prompt.citedChunks.length).toBeLessThan(5);
  });

  // A half-quoted source invites the model to finish the thought itself.
  it('drops a source whole rather than truncating it', () => {
    const long = chunk({ content: 'y'.repeat(9_000) });

    const prompt = buildPrompt({ question: 'q', chunks: [long], history: [] });

    expect(prompt.citedChunks).toEqual([]);
  });

  it('reports exactly the sources it put in the prompt', () => {
    const prompt = buildPrompt({
      question: 'q',
      chunks: [chunk({ documentTitle: 'Kept' })],
      history: [],
    });

    expect(prompt.citedChunks).toHaveLength(1);
    expect(system(prompt)).toContain('Kept');
  });
});
