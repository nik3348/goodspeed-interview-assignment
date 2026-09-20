import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { documentSchema } from '@repo/contracts';

import { ApiClientError } from '@/lib/api/client';
import { serverApiClient } from '@/lib/api/server';

import { DocumentForm } from '../document-form';

export const metadata: Metadata = { title: 'Edit document' };

export const dynamic = 'force-dynamic';

export default async function EditDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const api = await serverApiClient();

  let document;

  try {
    document = await api.request(`/documents/${id}`, {
      schema: documentSchema,
    });
  } catch (cause) {
    // A document owned by someone else is invisible rather than forbidden, so
    // 404 is what comes back and what the page should show.
    if (cause instanceof ApiClientError && cause.statusCode === 404) {
      notFound();
    }

    throw cause;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10 md:py-14">
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
        {document.title}
      </h1>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
        Editing the text re-embeds it; renaming or retagging does not.
      </p>

      <div className="mt-10">
        <DocumentForm document={document} />
      </div>
    </div>
  );
}
