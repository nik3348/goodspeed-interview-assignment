import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from '@jest/globals';

import type {
  IndexingOutcome,
  IndexingService,
} from '../indexing/indexing.service';
import type { SupabaseUserClient } from '../supabase/supabase-user-client';

import { DocumentsService } from './documents.service';

/**
 * A stand-in for the Supabase query builder.
 *
 * Every builder method returns `this` and the builder itself is thenable, so
 * a chain resolves to whatever result the test queued. Recording the calls
 * lets the tests assert on the query that was built, which is where the
 * interesting decisions live — the columns selected, the ordering, and which
 * filters are applied.
 */
class QueryBuilderStub {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  constructor(private readonly result: unknown) {}

  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }

  from = (...args: unknown[]) => this.record('from', args);
  select = (...args: unknown[]) => this.record('select', args);
  insert = (...args: unknown[]) => this.record('insert', args);
  update = (...args: unknown[]) => this.record('update', args);
  delete = (...args: unknown[]) => this.record('delete', args);
  eq = (...args: unknown[]) => this.record('eq', args);
  order = (...args: unknown[]) => this.record('order', args);
  range = (...args: unknown[]) => this.record('range', args);
  contains = (...args: unknown[]) => this.record('contains', args);
  single = (...args: unknown[]) => this.record('single', args);

  then<R>(resolve: (value: unknown) => R): Promise<R> {
    return Promise.resolve(resolve(this.result));
  }

  argsFor(method: string): unknown[] | undefined {
    return this.calls.find((call) => call.method === method)?.args;
  }

  called(method: string): boolean {
    return this.calls.some((call) => call.method === method);
  }
}

const INDEXED: IndexingOutcome = {
  status: 'indexed',
  chunkCount: 2,
  usage: null,
};

function serviceReturning(
  result: unknown,
  outcome: IndexingOutcome = INDEXED,
): {
  service: DocumentsService;
  builder: QueryBuilderStub;
  indexed: Array<{ documentId: string; content: string }>;
} {
  const builder = new QueryBuilderStub(result);
  const indexed: Array<{ documentId: string; content: string }> = [];

  const indexing = {
    indexDocument: async (documentId: string, content: string) => {
      indexed.push({ documentId, content });
      return outcome;
    },
  } as unknown as IndexingService;

  const service = new DocumentsService(
    { db: builder, userId: 'user-1' } as unknown as SupabaseUserClient,
    indexing,
  );

  return { service, builder, indexed };
}

function postgrestError(code: string): PostgrestError {
  return {
    code,
    message: 'stub',
    details: '',
    hint: '',
    name: 'PostgrestError',
  } as PostgrestError;
}

const ROW = {
  id: '3f6a1c9e-1111-4a7b-9c2d-000000000001',
  title: 'Mitochondria',
  content: 'the powerhouse of the cell',
  tags: ['bio'],
  created_at: '2026-09-20T10:00:00+00:00',
  updated_at: '2026-09-20T11:00:00+00:00',
  indexed_at: '2026-09-20T11:00:05+00:00',
  indexing_error: null,
  document_chunks: [{ count: 3 }],
};

describe('DocumentsService', () => {
  describe('list', () => {
    it('maps rows to the wire contract', async () => {
      const { service } = serviceReturning({
        data: [ROW],
        error: null,
        count: 1,
      });

      await expect(
        service.list({ limit: 50, offset: 0 }),
      ).resolves.toEqual({
        total: 1,
        documents: [
          {
            id: ROW.id,
            title: ROW.title,
            tags: ROW.tags,
            createdAt: ROW.created_at,
            updatedAt: ROW.updated_at,
            indexing: {
              status: 'indexed',
              indexedAt: ROW.indexed_at,
              error: null,
              chunkCount: 3,
            },
          },
        ],
      });
    });

    it('leaves document bodies out of the list query', async () => {
      const { service, builder } = serviceReturning({
        data: [],
        error: null,
        count: 0,
      });

      await service.list({ limit: 50, offset: 0 });

      expect(builder.argsFor('select')?.[0]).not.toContain('content');
    });

    it('orders by recency and translates offset paging into a range', async () => {
      const { service, builder } = serviceReturning({
        data: [],
        error: null,
        count: 0,
      });

      await service.list({ limit: 20, offset: 40 });

      expect(builder.argsFor('order')).toEqual([
        'updated_at',
        { ascending: false },
      ]);
      expect(builder.argsFor('range')).toEqual([40, 59]);
    });

    it('filters by tag with array containment, so the GIN index applies', async () => {
      const { service, builder } = serviceReturning({
        data: [],
        error: null,
        count: 0,
      });

      await service.list({ limit: 50, offset: 0, tag: 'bio' });

      expect(builder.argsFor('contains')).toEqual(['tags', ['bio']]);
    });

    it('omits the tag filter when none is asked for', async () => {
      const { service, builder } = serviceReturning({
        data: [],
        error: null,
        count: 0,
      });

      await service.list({ limit: 50, offset: 0 });

      expect(builder.called('contains')).toBe(false);
    });
  });

  describe('findOne', () => {
    it('returns the document with its content', async () => {
      const { service } = serviceReturning({ data: ROW, error: null });

      await expect(service.findOne(ROW.id)).resolves.toMatchObject({
        id: ROW.id,
        content: ROW.content,
      });
    });

    it('reports a row hidden by row-level security as not found', async () => {
      const { service } = serviceReturning({
        data: null,
        error: postgrestError('PGRST116'),
      });

      await expect(service.findOne(ROW.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('writes the owner alongside the payload', async () => {
      const { service, builder } = serviceReturning({
        data: ROW,
        error: null,
      });
      const userId = '00000000-0000-0000-0000-0000000000aa';

      await service.create(userId, {
        title: 'Mitochondria',
        content: 'the powerhouse of the cell',
        tags: ['bio'],
      });

      expect(builder.argsFor('insert')?.[0]).toEqual({
        user_id: userId,
        title: 'Mitochondria',
        content: 'the powerhouse of the cell',
        tags: ['bio'],
      });
    });

    it('surfaces a violated database constraint as a conflict', async () => {
      const { service } = serviceReturning({
        data: null,
        error: postgrestError('23514'),
      });

      await expect(
        service.create('00000000-0000-0000-0000-0000000000aa', {
          title: 'x',
          content: 'y',
          tags: [],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('sends only the fields the caller supplied', async () => {
      const { service, builder } = serviceReturning({
        data: ROW,
        error: null,
      });

      await service.update(ROW.id, { title: 'Renamed' });

      expect(builder.argsFor('update')?.[0]).toEqual({ title: 'Renamed' });
    });

    it('never lets the caller move a document to another owner', async () => {
      const { service, builder } = serviceReturning({
        data: ROW,
        error: null,
      });

      await service.update(ROW.id, {
        title: 'Renamed',
        content: 'new body',
        tags: ['a'],
      });

      expect(builder.argsFor('update')?.[0]).not.toHaveProperty('user_id');
    });

    it('does not touch updated_at, which a trigger maintains', async () => {
      const { service, builder } = serviceReturning({
        data: ROW,
        error: null,
      });

      await service.update(ROW.id, { title: 'Renamed' });

      expect(builder.argsFor('update')?.[0]).not.toHaveProperty('updated_at');
    });

    it('reports another user\'s document as not found', async () => {
      const { service } = serviceReturning({
        data: null,
        error: postgrestError('PGRST116'),
      });

      await expect(
        service.update(ROW.id, { title: 'Renamed' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('selects the deleted row so a no-op delete is not a silent success', async () => {
      const { service, builder } = serviceReturning({
        data: { id: ROW.id },
        error: null,
      });

      await service.remove(ROW.id);

      expect(builder.called('select')).toBe(true);
      expect(builder.called('single')).toBe(true);
    });

    it('reports a delete that matched nothing as not found', async () => {
      const { service } = serviceReturning({
        data: null,
        error: postgrestError('PGRST116'),
      });

      await expect(service.remove(ROW.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('indexing', () => {
    it('embeds the content it just stored on create', async () => {
      const { service, indexed } = serviceReturning({
        data: ROW,
        error: null,
      });

      await service.create('user-1', {
        title: ROW.title,
        content: ROW.content,
        tags: [],
      });

      expect(indexed).toEqual([
        { documentId: ROW.id, content: ROW.content },
      ]);
    });

    it('re-embeds when the content changed', async () => {
      const { service, indexed } = serviceReturning({
        data: { ...ROW, content: 'new body' },
        error: null,
      });

      await service.update(ROW.id, { content: 'new body' });

      expect(indexed).toHaveLength(1);
    });

    // Retitling does not change what the text means, so paying a provider to
    // re-embed it would be waste.
    it('does not re-embed for a title-only change', async () => {
      const { service, indexed } = serviceReturning({
        data: ROW,
        error: null,
      });

      await service.update(ROW.id, { title: 'Renamed' });

      expect(indexed).toEqual([]);
    });

    it('does not re-embed for a tag-only change', async () => {
      const { service, indexed } = serviceReturning({
        data: ROW,
        error: null,
      });

      await service.update(ROW.id, { tags: ['physics'] });

      expect(indexed).toEqual([]);
    });

    it('reports a successful index on the created document', async () => {
      const { service } = serviceReturning({ data: ROW, error: null });

      const document = await service.create('user-1', {
        title: ROW.title,
        content: ROW.content,
        tags: [],
      });

      expect(document.indexing).toMatchObject({
        status: 'indexed',
        error: null,
        chunkCount: 2,
      });
    });

    // The document is still saved; the client needs to know it is not
    // searchable rather than be told the write failed.
    it('surfaces an indexing failure without failing the write', async () => {
      const { service } = serviceReturning(
        { data: ROW, error: null },
        { status: 'failed', reason: 'provider out of credit' },
      );

      const document = await service.create('user-1', {
        title: ROW.title,
        content: ROW.content,
        tags: [],
      });

      expect(document.id).toBe(ROW.id);
      expect(document.indexing).toMatchObject({
        status: 'failed',
        error: 'provider out of credit',
        indexedAt: null,
      });
    });

    it('reads a never-indexed row as pending', async () => {
      const { service } = serviceReturning({
        data: { ...ROW, indexed_at: null, indexing_error: null },
        error: null,
      });

      const document = await service.findOne(ROW.id);

      expect(document.indexing.status).toBe('pending');
    });

    it('reads a row carrying an error as failed', async () => {
      const { service } = serviceReturning({
        data: { ...ROW, indexed_at: null, indexing_error: 'rate limited' },
        error: null,
      });

      const document = await service.findOne(ROW.id);

      expect(document.indexing).toMatchObject({
        status: 'failed',
        error: 'rate limited',
      });
    });

    it('re-embeds the stored content on an explicit reindex', async () => {
      const { service, indexed } = serviceReturning({
        data: ROW,
        error: null,
      });

      const document = await service.reindex(ROW.id);

      expect(indexed).toEqual([{ documentId: ROW.id, content: ROW.content }]);
      expect(document.indexing.status).toBe('indexed');
    });
  });
});
