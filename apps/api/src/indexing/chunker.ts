/**
 * Splits document text into segments suitable for embedding.
 *
 * The shape of the strategy, and why:
 *
 * **Structure first, size second.** Text is broken on blank lines into blocks
 * and blocks are packed greedily, so a chunk boundary lands between
 * paragraphs wherever possible. A fixed-width window would routinely cut a
 * sentence in half, and half a sentence embeds to a point that means neither
 * of the things it was between.
 *
 * **Headings travel with their content.** A retrieved chunk arrives with no
 * surrounding document, so "it costs $40/month" is useless without the
 * heading that said what "it" is. Each chunk is prefixed with the markdown
 * heading it falls under.
 *
 * **Overlap between neighbours.** A fact that straddles a boundary would
 * otherwise be in neither chunk's embedding. The tail of each chunk is
 * repeated at the head of the next, snapped to a sentence boundary so the
 * repeated text is itself coherent.
 *
 * **Characters, not tokens.** Counting real tokens means a tokenizer, and
 * every tokenizer is tied to a model family — which would undo the point of a
 * provider-agnostic layer. Characters are a stable proxy; the token figure
 * reported here is an estimate used for logging and cost display, not for
 * enforcing any provider's limit.
 */

export interface Chunk {
  /** Position in the document, zero-based. */
  index: number;
  /** Text to embed, including any heading prefix and overlap. */
  content: string;
  /** Rough token count. Estimated, never authoritative. */
  tokenEstimate: number;
}

export interface ChunkOptions {
  /**
   * Target size in characters, roughly 300 tokens.
   *
   * Small enough that a hit is specific — a match points at a paragraph
   * rather than a page — and that several chunks fit in a prompt alongside
   * the conversation. Large enough to hold a complete thought, which matters
   * because a chunk is embedded as a single point in vector space and a
   * fragment lands somewhere meaningless.
   */
  maxChars?: number;
  /** Characters of the previous chunk repeated at the start of the next. */
  overlapChars?: number;
  /** Chunks shorter than this are folded into their neighbour. */
  minChars?: number;
}

const DEFAULTS = {
  maxChars: 1_200,
  overlapChars: 180,
  minChars: 120,
} as const;

/** English averages close to four characters per token. */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunkDocument(
  content: string,
  options: ChunkOptions = {},
): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULTS.maxChars;
  const overlapChars = Math.min(
    options.overlapChars ?? DEFAULTS.overlapChars,
    Math.floor(maxChars / 2),
  );
  const minChars = options.minChars ?? DEFAULTS.minChars;

  const blocks = toBlocks(content, maxChars);

  if (blocks.length === 0) {
    return [];
  }

  const texts = pack(blocks, maxChars, overlapChars, minChars);

  return texts.map((text, index) => ({
    index,
    content: text,
    tokenEstimate: estimateTokens(text),
  }));
}

interface Block {
  text: string;
  /** The nearest preceding markdown heading, if any. */
  heading: string | null;
}

/** Splits into paragraph-sized blocks, tracking the heading each falls under. */
function toBlocks(content: string, maxChars: number): Block[] {
  const blocks: Block[] = [];
  let heading: string | null = null;

  for (const paragraph of content.split(/\n\s*\n/)) {
    const text = paragraph.trim();

    if (text === '') {
      continue;
    }

    const headingMatch = /^#{1,6}\s+(.*)$/.exec(text);

    if (headingMatch?.[1]) {
      // A heading is context for what follows, not content in its own right.
      heading = headingMatch[1].trim();
      continue;
    }

    // A single paragraph longer than a whole chunk has to be broken up, but
    // between sentences rather than mid-word.
    for (const piece of splitOversized(text, maxChars)) {
      blocks.push({ text: piece, heading });
    }
  }

  return blocks;
}

function splitOversized(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const pieces: string[] = [];
  let current = '';

  for (const sentence of toSentences(text)) {
    if (current !== '' && current.length + sentence.length > maxChars) {
      pieces.push(current.trim());
      current = '';
    }

    // A single sentence over the limit — a URL dump, minified data — has no
    // natural boundary left, so a hard cut is the only option.
    if (sentence.length > maxChars) {
      for (let at = 0; at < sentence.length; at += maxChars) {
        pieces.push(sentence.slice(at, at + maxChars).trim());
      }
      continue;
    }

    current += sentence;
  }

  if (current.trim() !== '') {
    pieces.push(current.trim());
  }

  return pieces.filter((piece) => piece !== '');
}

/** Keeps the terminator attached, so rejoined sentences read correctly. */
function toSentences(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+["')\]]*\s*|$)/g) ?? [text];
}

function pack(
  blocks: Block[],
  maxChars: number,
  overlapChars: number,
  minChars: number,
): string[] {
  const chunks: string[] = [];
  let current: Block[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length === 0) {
      return;
    }

    chunks.push(render(current, chunks, overlapChars));
    current = [];
    currentLength = 0;
  };

  for (const block of blocks) {
    const addedLength = currentLength === 0 ? block.text.length : currentLength + block.text.length + 2;

    if (currentLength > 0 && addedLength > maxChars) {
      flush();
    }

    current.push(block);
    currentLength =
      current.length === 1 ? block.text.length : currentLength + block.text.length + 2;
  }

  flush();

  return mergeRunts(chunks, minChars, maxChars);
}

function render(
  blocks: Block[],
  previousChunks: string[],
  overlapChars: number,
): string {
  const previous = previousChunks.at(-1);
  const overlap =
    previous === undefined ? '' : tailOf(previous, overlapChars);

  // Headings were lifted out of the text when blocks were built, so they have
  // to be put back. Re-emitting on every change rather than only at the start
  // matters when a chunk spans a section boundary: otherwise the second
  // section's heading is stripped and never restored, and the chunk silently
  // loses the words that said what it was about.
  const body: string[] = [];
  let lastHeading: string | null | undefined;

  for (const block of blocks) {
    if (block.heading !== lastHeading && block.heading !== null) {
      body.push(`## ${block.heading}`);
    }

    lastHeading = block.heading;
    body.push(block.text);
  }

  // The first heading precedes the overlap, so the chunk reads as a titled
  // excerpt rather than as a fragment.
  const leadingHeading = blocks[0]?.heading;
  const parts =
    leadingHeading === null || leadingHeading === undefined
      ? [overlap, ...body]
      : [body[0] ?? '', overlap, ...body.slice(1)];

  return parts.filter((part) => part !== '').join('\n\n');
}

/** The last whole sentences of `text`, up to `limit` characters. */
function tailOf(text: string, limit: number): string {
  if (limit <= 0) {
    return '';
  }

  const window = text.slice(-limit);
  const sentenceStart = window.search(/[.!?]["')\]]*\s+\S/);

  if (sentenceStart === -1) {
    // No sentence boundary in the window; fall back to a word boundary so the
    // overlap at least starts with a whole word.
    const wordStart = window.indexOf(' ');
    return wordStart === -1 ? '' : window.slice(wordStart + 1).trim();
  }

  return window
    .slice(sentenceStart)
    .replace(/^[.!?]["')\]]*\s+/, '')
    .trim();
}

/**
 * A trailing scrap carries little meaning on its own and pollutes retrieval,
 * so it is folded back into the chunk before it when there is room.
 */
function mergeRunts(
  chunks: string[],
  minChars: number,
  maxChars: number,
): string[] {
  if (chunks.length < 2) {
    return chunks;
  }

  const merged = [...chunks];
  const last = merged.at(-1) ?? '';
  const previous = merged.at(-2) ?? '';

  if (
    last.length < minChars &&
    previous.length + last.length + 2 <= maxChars * 1.25
  ) {
    merged.splice(-2, 2, `${previous}\n\n${last}`);
  }

  return merged;
}
