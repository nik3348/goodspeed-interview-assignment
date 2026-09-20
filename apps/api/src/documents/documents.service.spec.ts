import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from '@jest/globals';

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

function serviceReturning(result: unknown): {
  service: DocumentsService;
  builder: QueryBuilderStub;
} {
  const builder = new QueryBuilderStub(result);
  const service = new DocumentsService({
    db: builder,
  } as unknown as SupabaseUserClient);

  return { service, builder };
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
});
