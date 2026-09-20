/**
 * The vocabulary the application uses to talk to a model.
 *
 * These types deliberately do not mirror any vendor's SDK. Application code
 * depends on this file, never on `openai` — that import is confined to the
 * adapter in `./openai`. Swapping in a provider that does not speak the OpenAI
 * wire format therefore means writing one new adapter, not editing callers.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** 0 is deterministic. Left to the caller because RAG wants it low. */
  temperature?: number;
  maxOutputTokens?: number;
  /** Lets an HTTP handler cancel generation when the client disconnects. */
  signal?: AbortSignal;
}

/** Null when a provider declines to report usage, as several do. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Why generation stopped. Providers spell these differently; the adapter
 * normalises them so callers can act on `length` without a vendor lookup.
 */
export type FinishReason = 'stop' | 'length' | 'content_filter' | 'other';

export interface ChatCompletion {
  content: string;
  /** The model that actually answered, which may differ from the one asked for. */
  model: string;
  finishReason: FinishReason;
  usage: TokenUsage | null;
}

/**
 * A streamed response: zero or more deltas, then exactly one `done` carrying
 * the assembled result. Consumers that do not care about streaming can ignore
 * the deltas and keep the final event.
 */
export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; completion: ChatCompletion };

export interface EmbeddingRequest {
  inputs: string[];
  signal?: AbortSignal;
}

export interface EmbeddingResult {
  /** One vector per input, in the order the inputs were given. */
  embeddings: number[][];
  usage: TokenUsage | null;
}
