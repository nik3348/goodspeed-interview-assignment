'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Citation } from '@repo/contracts';

/**
 * The passages an answer was built from.
 *
 * Collapsed by default: the numbered markers in the text already say where
 * each claim came from, and the value of the full excerpt is in being
 * available on demand rather than in competing with the answer. A citation
 * whose document has since been deleted keeps its title and text — that is why
 * the excerpt is stored with the answer rather than joined on read.
 */
export function Citations({ citations }: { citations: Citation[] }) {
  const [openRank, setOpenRank] = useState<number | null>(null);

  if (citations.length === 0) {
    return null;
  }

  return (
    <div className="mt-3">
      <ul className="flex flex-wrap gap-1.5">
        {citations.map((citation) => {
          const isOpen = openRank === citation.rank;

          return (
            <li key={citation.rank}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenRank(isOpen ? null : citation.rank)}
                className="flex items-baseline gap-1.5 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:border-accent"
              >
                <span className="font-mono text-accent-foreground">
                  {citation.rank}
                </span>
                <span className="max-w-[14rem] truncate text-muted-foreground">
                  {citation.documentTitle}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {citations
        .filter((citation) => citation.rank === openRank)
        .map((citation) => (
          <figure
            key={citation.rank}
            className="mt-2 border-l-2 border-accent pl-4"
          >
            <blockquote className="text-[0.875rem] leading-relaxed text-muted-foreground">
              {citation.excerpt}
            </blockquote>
            <figcaption className="mt-2 text-xs text-muted-foreground">
              {citation.documentId === null ? (
                <span>
                  {citation.documentTitle} — this document has since been
                  deleted
                </span>
              ) : (
                <Link
                  href={`/documents/${citation.documentId}`}
                  className="underline decoration-accent underline-offset-4"
                >
                  {citation.documentTitle}
                </Link>
              )}
              <span className="ml-2 font-mono">
                {citation.similarity.toFixed(2)}
              </span>
            </figcaption>
          </figure>
        ))}
    </div>
  );
}
