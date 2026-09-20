import Link from 'next/link';
import type { VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

import { buttonVariants } from './button';

type ButtonLinkProps = React.ComponentProps<typeof Link> &
  VariantProps<typeof buttonVariants>;

/**
 * A link that looks like a button.
 *
 * Deliberately built from `buttonVariants` on a plain `Link` rather than from
 * Base UI's `Button`. Handing `Button` an anchor makes it either warn (it
 * expects a real `<button>`) or, with `nativeButton={false}`, stamp
 * `role="button"` onto the anchor — which announces "button" to a screen
 * reader for something that navigates, and drops it out of the page's list of
 * links. The styling is the only part worth sharing; the semantics of a link
 * are already correct and are what middle-click and "open in new tab" rely on.
 */
export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
