'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MAX_TITLE_LENGTH,
  documentSchema,
  type Document,
} from '@repo/contracts';

import { IndexingState } from '@/components/indexing-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { browserApiClient } from '@/lib/api/browser';
import { ApiClientError } from '@/lib/api/client';

const labelClassName = 'text-[0.8125rem] font-medium text-muted-foreground';

export function DocumentForm({ document }: { document?: Document }) {
  const router = useRouter();
  const isEditing = document !== undefined;

  const [title, setTitle] = useState(document?.title ?? '');
  const [content, setContent] = useState(document?.content ?? '');
  const [tags, setTags] = useState(document?.tags.join(', ') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState<Document | undefined>(document);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    const body = {
      title: title.trim(),
      content,
      tags: toTags(tags),
    };

    try {
      const result = await browserApiClient().request(
        isEditing ? `/documents/${document.id}` : '/documents',
        {
          method: isEditing ? 'PATCH' : 'POST',
          body,
          schema: documentSchema,
        },
      );

      setSaved(result);

      if (isEditing) {
        router.refresh();
      } else {
        router.push(`/documents/${result.id}`);
      }
    } catch (cause) {
      setError(
        cause instanceof ApiClientError
          ? cause.message
          : 'Could not save that document.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-7">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title" className={labelClassName}>
          Title
        </Label>
        <Input
          id="title"
          required
          maxLength={MAX_TITLE_LENGTH}
          value={title}
          placeholder="Expenses policy"
          onChange={(event) => setTitle(event.target.value)}
          className="h-10 text-[1.0625rem]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="content" className={labelClassName}>
          Content
        </Label>
        <Textarea
          id="content"
          required
          rows={18}
          value={content}
          placeholder={'# Section\n\nMarkdown headings are kept with their text when the document is split up, so an answer can say where it came from.'}
          onChange={(event) => setContent(event.target.value)}
          className="resize-y font-mono text-[0.875rem] leading-relaxed"
        />
        <p className="text-xs text-muted-foreground">
          Headings help: each passage is stored with the heading it sits under.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tags" className={labelClassName}>
          Tags
        </Label>
        <Input
          id="tags"
          value={tags}
          placeholder="policy, travel"
          onChange={(event) => setTags(event.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-6">
        <Button type="submit" size="lg" disabled={isSaving}>
          {isSaving
            ? 'Saving…'
            : isEditing
              ? 'Save changes'
              : 'Create document'}
        </Button>

        <Button variant="ghost" size="lg" render={<Link href="/documents" />}>
          Back to documents
        </Button>

        {saved ? (
          <span className="ml-auto">
            <IndexingState indexing={saved.indexing} />
          </span>
        ) : null}
      </div>

      {saved?.indexing.status === 'failed' ? (
        <IndexingFailure documentId={saved.id} reason={saved.indexing.error} />
      ) : null}
    </form>
  );
}

/**
 * The document saved but could not be embedded, which is a distinct and
 * recoverable state — so it gets an explanation and a retry rather than being
 * folded into a generic error.
 */
function IndexingFailure({
  documentId,
  reason,
}: {
  documentId: string;
  reason: string | null;
}) {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);

  async function handleRetry() {
    setIsRetrying(true);

    try {
      await browserApiClient().request(`/documents/${documentId}/reindex`, {
        method: 'POST',
      });
      router.refresh();
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <div className="border-l-2 border-destructive pl-4">
      <p className="text-sm text-foreground">
        This document is saved, but could not be made searchable.
      </p>
      {reason ? (
        <p className="mt-1 font-mono text-xs text-muted-foreground">{reason}</p>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        disabled={isRetrying}
        onClick={handleRetry}
      >
        {isRetrying ? 'Retrying…' : 'Try again'}
      </Button>
    </div>
  );
}

function toTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag !== ''),
    ),
  ];
}
