import type { Metadata } from 'next';
import Link from 'next/link';
import { documentListSchema } from '@repo/contracts';

import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api/client';
import { serverApiClient } from '@/lib/api/server';

import { DocumentList } from './document-list';

export const metadata: Metadata = { title: 'Documents' };

// The list reflects writes made moments ago, so it is never served from cache.
export const dynamic = 'force-dynamic';

export default async function DocumentsPage() {
  const api = await serverApiClient();

  let listing;
  let error: string | null = null;

  try {
    listing = await api.request('/documents', { schema: documentListSchema });
  } catch (cause) {
    error =
      cause instanceof ApiClientError
        ? cause.message
        : 'Could not reach the API. Is it running?';
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10 md:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
            Documents
          </h1>
          <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
            Everything here is searchable from the Ask tab.
          </p>
        </div>

        <Button size="lg" render={<Link href="/documents/new" />}>
          New document
        </Button>
      </div>

      <div className="mt-10">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <DocumentList documents={listing?.documents ?? []} />
        )}
      </div>
    </div>
  );
}
