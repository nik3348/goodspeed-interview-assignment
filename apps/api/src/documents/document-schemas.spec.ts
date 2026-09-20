import { createDocumentSchema, updateDocumentSchema } from '@repo/contracts';
import { describe, expect, it } from '@jest/globals';

describe('createDocumentSchema', () => {
  it('defaults absent tags to none', () => {
    const parsed = createDocumentSchema.parse({
      title: 'Title',
      content: 'Body',
    });

    expect(parsed.tags).toEqual([]);
  });

  it('normalises tags so filtering is case-insensitive', () => {
    const parsed = createDocumentSchema.parse({
      title: 'Title',
      content: 'Body',
      tags: ['Bio', ' NOTES '],
    });

    expect(parsed.tags).toEqual(['bio', 'notes']);
  });

  it('rejects a title that is only whitespace', () => {
    expect(
      createDocumentSchema.safeParse({ title: '   ', content: 'Body' }).success,
    ).toBe(false);
  });
});

describe('updateDocumentSchema', () => {
  // Regression: deriving this schema with `.partial()` kept the `tags`
  // default, so a title-only PATCH silently cleared the document's tags.
  it('leaves tags absent when the caller did not mention them', () => {
    const parsed = updateDocumentSchema.parse({ title: 'Renamed' });

    expect(parsed).not.toHaveProperty('tags');
  });

  it('rejects an empty patch rather than reporting a no-op as success', () => {
    expect(updateDocumentSchema.safeParse({}).success).toBe(false);
  });

  it('still allows tags to be cleared explicitly', () => {
    expect(updateDocumentSchema.parse({ tags: [] })).toEqual({ tags: [] });
  });

  it('accepts a single field', () => {
    expect(updateDocumentSchema.parse({ content: 'New body' })).toEqual({
      content: 'New body',
    });
  });
});
