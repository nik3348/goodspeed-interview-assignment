import type { EmbeddingRequest, EmbeddingResult } from './messages';

/** Injection token for the configured embedding model. */
export const EMBEDDING_MODEL = Symbol('EMBEDDING_MODEL');

export interface EmbeddingModel {
  readonly model: string;

  /**
   * The vector width this model produces. The pgvector column is a fixed
   * width, so this is checked rather than assumed — see `AiModule`.
   */
  readonly dimensions: number;

  /**
   * Inputs a single request may carry. Callers pass whatever they have and
   * the adapter splits the work; this is exposed for callers that want to
   * size their own batches.
   */
  readonly maxBatchSize: number;

  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}
