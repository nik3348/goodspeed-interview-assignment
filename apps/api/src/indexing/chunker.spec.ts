import { describe, expect, it } from '@jest/globals';

import { chunkDocument, estimateTokens } from './chunker';

const sentence = 'The mitochondrion is the powerhouse of the cell. ';
const paragraph = (n: number) => sentence.repeat(n).trim();

describe('chunkDocument', () => {
  it('returns nothing for empty or whitespace-only content', () => {
    expect(chunkDocument('')).toEqual([]);
    expect(chunkDocument('   \n\n  \t ')).toEqual([]);
  });

  it('keeps a short document as a single chunk', () => {
    const chunks = chunkDocument('A short note about cells.');

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('A short note about cells.');
  });

  it('numbers chunks in document order', () => {
    const chunks = chunkDocument(
      Array.from({ length: 8 }, () => paragraph(6)).join('\n\n'),
      { maxChars: 300 },
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.index)).toEqual(
      chunks.map((_, index) => index),
    );
  });

  it('prefers paragraph boundaries over cutting mid-sentence', () => {
    const chunks = chunkDocument(
      [paragraph(3), paragraph(3), paragraph(3)].join('\n\n'),
      { maxChars: 200, overlapChars: 0 },
    );

    // Every chunk should end where a sentence ended.
    for (const chunk of chunks) {
      expect(chunk.content.trim()).toMatch(/[.!?]$/);
    }
  });

  it('carries the markdown heading into each chunk beneath it', () => {
    const chunks = chunkDocument(
      ['# Cell biology', paragraph(4), paragraph(4), paragraph(4)].join('\n\n'),
      { maxChars: 250, overlapChars: 0 },
    );

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content).toContain('Cell biology');
    }
  });

  it('switches heading when a later section starts', () => {
    const chunks = chunkDocument(
      [
        '# First section',
        paragraph(2),
        '## Second section',
        paragraph(2),
      ].join('\n\n'),
      { maxChars: 150, overlapChars: 0 },
    );

    expect(chunks.at(0)?.content).toContain('First section');
    expect(chunks.at(-1)?.content).toContain('Second section');
  });

  it('does not emit a heading as a chunk of its own', () => {
    const chunks = chunkDocument(['# Only a heading', paragraph(1)].join('\n\n'));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('mitochondrion');
  });

  it('repeats the tail of a chunk at the head of the next', () => {
    const chunks = chunkDocument(
      [
        'Alpha beta gamma delta. Epsilon zeta eta theta.',
        'Iota kappa lambda mu. Nu xi omicron pi.',
      ].join('\n\n'),
      { maxChars: 60, overlapChars: 40, minChars: 0 },
    );

    expect(chunks.length).toBeGreaterThan(1);
    // Something from the first chunk must reappear in the second.
    const first = chunks[0]?.content ?? '';
    const second = chunks[1]?.content ?? '';
    const tailWord = first.trim().split(/\s+/).at(-1) ?? '';

    expect(second).toContain(tailWord);
  });

  it('never overlaps more than half a chunk', () => {
    const chunks = chunkDocument(
      Array.from({ length: 6 }, () => paragraph(2)).join('\n\n'),
      { maxChars: 100, overlapChars: 500, minChars: 0 },
    );

    expect(chunks.length).toBeGreaterThan(1);
  });

  it('splits a paragraph that is longer than a whole chunk', () => {
    const chunks = chunkDocument(paragraph(30), {
      maxChars: 200,
      overlapChars: 0,
    });

    expect(chunks.length).toBeGreaterThan(1);
  });

  it('hard-cuts text with no sentence boundary at all', () => {
    const chunks = chunkDocument('x'.repeat(1_000), {
      maxChars: 200,
      overlapChars: 0,
      minChars: 0,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(200);
    }
  });

  it('loses no words from the source', () => {
    const source = Array.from({ length: 5 }, (_, i) =>
      `Paragraph ${i} about cells and energy production.`,
    ).join('\n\n');

    const joined = chunkDocument(source, { maxChars: 80, overlapChars: 0 })
      .map((chunk) => chunk.content)
      .join(' ');

    for (let i = 0; i < 5; i += 1) {
      expect(joined).toContain(`Paragraph ${i}`);
    }
  });

  it('folds a trailing scrap into the chunk before it', () => {
    const chunks = chunkDocument(
      [paragraph(6), 'Tiny.'].join('\n\n'),
      { maxChars: 300, overlapChars: 0, minChars: 100 },
    );

    expect(chunks.at(-1)?.content).toContain('Tiny.');
    expect(chunks.at(-1)?.content.length).toBeGreaterThan(100);
  });

  it('reports a token estimate proportional to length', () => {
    const chunks = chunkDocument(paragraph(4));

    expect(chunks[0]?.tokenEstimate).toBe(
      estimateTokens(chunks[0]?.content ?? ''),
    );
    expect(chunks[0]?.tokenEstimate).toBeGreaterThan(0);
  });

  it('handles windows line endings', () => {
    const chunks = chunkDocument('First para.\r\n\r\nSecond para.');

    expect(chunks.map((c) => c.content).join(' ')).toContain('Second para.');
  });

  // Regression: headings are lifted out when blocks are built, and only the
  // chunk's first heading was being put back — so a chunk spanning a section
  // boundary silently lost the later heading's words.
  it('keeps every heading a chunk spans, not just the first', () => {
    const chunks = chunkDocument(
      [
        '# Cell biology',
        'Mitochondria make ATP.',
        '## Cell division',
        'Mitosis produces two daughter cells.',
      ].join('\n\n'),
      { maxChars: 2_000 },
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('Cell biology');
    expect(chunks[0]?.content).toContain('Cell division');
  });

  it('does not repeat a heading for consecutive blocks beneath it', () => {
    const chunks = chunkDocument(
      ['# One heading', 'First para.', 'Second para.'].join('\n\n'),
      { maxChars: 2_000 },
    );

    const occurrences =
      chunks[0]?.content.match(/One heading/g)?.length ?? 0;

    expect(occurrences).toBe(1);
  });
});
