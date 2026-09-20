import type { ChatMessage } from '../ai/messages';

import type { RetrievedChunk } from './retrieval.service';

/**
 * How much retrieved text may go into one prompt.
 *
 * A budget rather than a chunk count, because chunk sizes vary and the failure
 * mode of exceeding a context window is a hard error mid-conversation.
 */
const MAX_CONTEXT_CHARS = 8_000;

/** Turns kept from the transcript. Enough for pronouns to resolve. */
const MAX_HISTORY_MESSAGES = 8;

const SYSTEM_PROMPT = `You are a knowledge base assistant. Answer the user's question using only the sources provided below.

Rules:
- Use only the sources. Do not rely on outside knowledge, even if you are confident.
- Cite the sources you used inline, as [1], [2], matching the numbers below.
- If the sources do not contain the answer, say so plainly and do not guess. It is far better to say "the documents don't cover that" than to invent something plausible.
- If the sources only partly answer the question, answer that part and say which part is missing.
- Quote sparingly and write in your own words.
- Keep the answer as short as the question allows.`;

export interface PromptInput {
  question: string;
  chunks: RetrievedChunk[];
  /** Prior turns, oldest first. */
  history: { role: 'user' | 'assistant'; content: string }[];
}

export interface BuiltPrompt {
  messages: ChatMessage[];
  /** The chunks that fitted the budget, in citation order. */
  citedChunks: RetrievedChunk[];
}

/**
 * Assembles the request sent to the model.
 *
 * Context goes in the system message rather than the transcript, and is
 * rebuilt for every question. Appending it to history instead would let stale
 * context from earlier turns compete with what was retrieved for the question
 * actually being asked, and would grow the prompt without bound.
 */
export function buildPrompt({
  question,
  chunks,
  history,
}: PromptInput): BuiltPrompt {
  const citedChunks = withinBudget(chunks, MAX_CONTEXT_CHARS);

  const messages: ChatMessage[] = [
    { role: 'system', content: renderSystemPrompt(citedChunks) },
    ...history.slice(-MAX_HISTORY_MESSAGES),
    { role: 'user', content: question },
  ];

  return { messages, citedChunks };
}

function renderSystemPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return `${SYSTEM_PROMPT}

Sources:
(none — nothing in the knowledge base matched this question)`;
  }

  const sources = chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.documentTitle}\n${chunk.content}`,
    )
    .join('\n\n');

  return `${SYSTEM_PROMPT}

Sources:
${sources}`;
}

/**
 * Takes chunks in rank order until the budget runs out.
 *
 * Truncating a chunk's text would be worse than dropping it: a half-quoted
 * source invites the model to complete the thought itself, which is the
 * failure this whole prompt is written to avoid.
 */
function withinBudget(
  chunks: RetrievedChunk[],
  maxChars: number,
): RetrievedChunk[] {
  const kept: RetrievedChunk[] = [];
  let used = 0;

  for (const chunk of chunks) {
    const cost = chunk.content.length + chunk.documentTitle.length;

    if (used + cost > maxChars) {
      break;
    }

    kept.push(chunk);
    used += cost;
  }

  return kept;
}
