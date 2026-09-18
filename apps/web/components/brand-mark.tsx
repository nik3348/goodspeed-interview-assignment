/**
 * A word with its underline — the visual definition of a link, and the same
 * accent underline the text links on these pages use. Abstract on purpose: a
 * chain glyph is the obvious choice and every link tool already uses it.
 */
export function BrandMark() {
  return (
    <span aria-hidden="true" className="flex w-fit flex-col gap-[3px]">
      <span className="block h-[5px] w-10 bg-foreground" />
      <span className="block h-[2px] w-10 bg-accent" />
    </span>
  );
}
