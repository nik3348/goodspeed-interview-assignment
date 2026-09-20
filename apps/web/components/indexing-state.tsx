import type { DocumentIndexing } from '@repo/contracts';

import { cn } from '@/lib/utils';

/**
 * Says whether a document can actually be found by a question.
 *
 * Worth surfacing because embedding depends on a third party and fails
 * independently of saving: a document that looks fine in the list but never
 * appears in an answer is otherwise impossible to diagnose from the outside.
 */
export function IndexingState({
  indexing,
  className,
}: {
  indexing: DocumentIndexing;
  className?: string;
}) {
  const { status, chunkCount } = indexing;

  if (status === 'indexed') {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>
        {chunkCount === null
          ? 'Searchable'
          : `Searchable · ${chunkCount} ${chunkCount === 1 ? 'passage' : 'passages'}`}
      </span>
    );
  }

  if (status === 'pending') {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>
        Not yet searchable
      </span>
    );
  }

  return (
    <span className={cn('text-xs text-destructive', className)}>
      Could not be indexed
    </span>
  );
}
