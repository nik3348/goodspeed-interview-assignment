import { Fragment } from 'react';

/**
 * Renders an answer with its `[1]` markers picked out.
 *
 * Deliberately not a markdown renderer: the model is told to write prose, and
 * the one piece of structure that genuinely carries meaning here is the
 * citation marker, which markdown would render as literal brackets.
 */
export function AnswerText({ content }: { content: string }) {
  const parts = content.split(/(\[\d{1,2}\])/g);

  return (
    <p className="text-[0.9375rem] leading-relaxed whitespace-pre-wrap">
      {parts.map((part, index) => {
        const marker = /^\[(\d{1,2})\]$/.exec(part);

        return marker ? (
          <sup
            key={index}
            className="mx-0.5 font-mono text-[0.6875rem] text-accent-foreground"
          >
            {marker[1]}
          </sup>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        );
      })}
    </p>
  );
}
