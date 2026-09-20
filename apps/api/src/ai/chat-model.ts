import type { ChatCompletion, ChatRequest, ChatStreamEvent } from './messages';

/** Injection token for the configured chat model. */
export const CHAT_MODEL = Symbol('CHAT_MODEL');

/**
 * A conversational model.
 *
 * Two methods rather than a `stream: boolean` flag, because the return types
 * genuinely differ and a boolean would force every caller to narrow a union
 * it already knows the answer to.
 */
export interface ChatModel {
  /** The configured model identifier, for logging and usage attribution. */
  readonly model: string;

  complete(request: ChatRequest): Promise<ChatCompletion>;

  stream(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
}
