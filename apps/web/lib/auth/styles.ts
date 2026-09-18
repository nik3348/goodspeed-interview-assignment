/**
 * The auth screens share one visual language, kept here so sign in and sign up
 * cannot drift apart.
 */

/**
 * The field is its underline rather than a box. Credentials are set in the mono
 * face because that is how an address is read everywhere else — and this product
 * is about addresses. Focus thickens the rule in the accent colour; an invalid
 * field switches the same rule to destructive. No ring in either case, since a
 * ring around a borderless input floats unattached.
 *
 * The `md:` size looks redundant next to the base size, but the shadcn Input
 * ships `md:text-sm`; tailwind-merge keeps it because it is a different variant
 * group, and it would otherwise shrink the field text on desktop only.
 */
export const authFieldClassName =
  'h-auto rounded-none border-0 border-b border-input bg-transparent px-0 py-2 font-mono text-[0.9375rem] md:text-[0.9375rem] focus-visible:border-b-2 focus-visible:border-accent focus-visible:ring-0 aria-invalid:border-destructive aria-invalid:ring-0';

export const authButtonClassName =
  'mt-1 h-11 w-full rounded-none text-[0.9375rem] font-semibold';

export const authLabelClassName =
  'text-[0.8125rem] font-normal text-muted-foreground';
export const authHintClassName = 'text-[0.75rem] text-muted-foreground';
export const authFooterClassName = 'text-[0.8125rem] text-muted-foreground';
