import { z } from 'zod';

export const MAX_QUESTION_LENGTH = 4_000;
export const MAX_CONVERSATION_TITLE_LENGTH = 200;

/**
 * A source that informed an answer.
 *
 * The title and excerpt are snapshots taken when the answer was given, not
 * joins onto the live document, so an answer stays explicable after its source
 * is edited or deleted. `documentId` is nullable for exactly that reason.
 */
export const citationSchema = z.object({
  /** Position in the answer's citation list; `[1]` in the text is rank 1. */
  rank: z.number().int().positive(),
  documentId: z.uuid().nullable(),
  documentTitle: z.string(),
  excerpt: z.string(),
  similarity: z.number(),
});

export type Citation = z.infer<typeof citationSchema>;

export const messageRoleSchema = z.enum(['user', 'assistant']);

export type MessageRole = z.infer<typeof messageRoleSchema>;

export const tokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export type TokenUsageSummary = z.infer<typeof tokenUsageSchema>;

/** One persisted turn. Named to avoid confusion with a provider message. */
export const conversationMessageSchema = z.object({
  id: z.uuid(),
  role: messageRoleSchema,
  content: z.string(),
  createdAt: z.string(),
  /** Which model answered; null on a user turn. */
  model: z.string().nullable(),
  /** Null when the turn is a user's, or the provider reported no usage. */
  usage: tokenUsageSchema.nullable(),
  citations: z.array(citationSchema),
});

export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const conversationSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Conversation = z.infer<typeof conversationSchema>;

export const conversationDetailSchema = conversationSchema.extend({
  messages: z.array(conversationMessageSchema),
});

export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const conversationListSchema = z.object({
  conversations: z.array(conversationSchema),
  total: z.number().int().nonnegative(),
});

export type ConversationList = z.infer<typeof conversationListSchema>;

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(MAX_CONVERSATION_TITLE_LENGTH).optional(),
});

export type CreateConversation = z.infer<typeof createConversationSchema>;

export const askQuestionSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
  /**
   * Restricts retrieval to these documents. Absent means search everything the
   * user owns.
   */
  documentIds: z.array(z.uuid()).max(50).optional(),
});

export type AskQuestion = z.infer<typeof askQuestionSchema>;

export const answerSchema = z.object({
  conversation: conversationSchema,
  userMessage: conversationMessageSchema,
  assistantMessage: conversationMessageSchema,
});

export type Answer = z.infer<typeof answerSchema>;

/**
 * Server-sent events for a streamed answer.
 *
 * Citations arrive first, before any text: the sources are known as soon as
 * retrieval finishes, and showing them while the answer types out is both
 * faster to feel and more honest about where the words are coming from.
 */
export const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('citations'),
    citations: z.array(citationSchema),
  }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({
    type: z.literal('done'),
    assistantMessage: conversationMessageSchema,
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);

export type ChatStreamEventPayload = z.infer<typeof chatStreamEventSchema>;
