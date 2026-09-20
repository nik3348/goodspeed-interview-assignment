'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DocumentSummary } from '@repo/contracts';

import { IndexingState } from '@/components/indexing-state';
import { Button } from '@/components/ui/button';
import { browserApiClient } from '@/lib/api/browser';
import { ApiClientError } from '@/lib/api/client';

export function DocumentList({ documents }: { documents: DocumentSummary[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(document: DocumentSummary) {
    if (!window.confirm(`Delete “${document.title}”? This cannot be undone.`)) {
      return;
    }

    setError(null);
    setDeletingId(document.id);

    try {
      await browserApiClient().request(`/documents/${document.id}`, {
        method: 'DELETE',
      });
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiClientError
          ? cause.message
          : 'Could not delete that document.',
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (documents.length === 0) {
    return (
      <div className="border-t border-border pt-10">
        <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
          Nothing here yet. Add a document and it becomes answerable within a
          few seconds.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {error ? (
        <p role="alert" className="pb-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <ul className="border-t border-border">
        {documents.map((document) => (
          <li
            key={document.id}
            className="group flex items-baseline gap-4 border-b border-border py-4"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={`/documents/${document.id}`}
                className="text-[1.0625rem] font-medium hover:text-accent-foreground hover:underline hover:decoration-accent hover:underline-offset-4"
              >
                {document.title}
              </Link>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <IndexingState indexing={document.indexing} />
                {document.tags.length > 0 ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {document.tags.join('  ')}
                  </span>
                ) : null}
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              disabled={deletingId === document.id}
              onClick={() => handleDelete(document)}
              className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              {deletingId === document.id ? 'Deleting…' : 'Delete'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
