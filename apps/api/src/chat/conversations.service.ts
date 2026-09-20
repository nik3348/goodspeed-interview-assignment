import { Injectable } from '@nestjs/common';
import type {
  Citation,
  Conversation,
  ConversationDetail,
  ConversationList,
  ConversationMessage,
  CreateConversation,
  MessageRole,
} from '@repo/contracts';

import type { TokenUsage } from '../ai/messages';
import { throwPostgrestError } from '../supabase/postgrest-error';
import { SupabaseUserClient } from '../supabase/supabase-user-client';

import type { RetrievedChunk } from './retrieval.service';

const CONVERSATION_COLUMNS = 'id, title, created_at, updated_at';
// One literal, not a concatenation: the typed client parses this string at
// compile time to derive the row shape, and `+` widens it to plain `string`.
const MESSAGE_COLUMNS =
  'id, role, content, model, prompt_tokens, completion_tokens, created_at, message_citations(rank, document_id, document_title, excerpt, similarity)';

const MESSAGE_WITHOUT_CITATIONS =
  'id, role, content, model, prompt_tokens, completion_tokens, created_at';

/** How much of a question becomes the conversation's title. */
const TITLE_LENGTH = 60;

/** Length of the snippet stored with a citation for display. */
const EXCERPT_LENGTH = 320;

/**
 * Reading and writing the transcript.
 *
 * Kept separate from `ChatService`, which orchestrates retrieval and the model
 * call: one owns persistence, the other owns the answer. Every query runs as
 * the caller, so row-level security scopes conversations to their owner.
 */
@Injectable()
export class ConversationsService {
  constructor(private readonly supabase: SupabaseUserClient) {}

  async list(): Promise<ConversationList> {
    const { data, error, count } = await this.supabase.db
      .from('conversations')
      .select(CONVERSATION_COLUMNS, { count: 'exact' })
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) {
      throwPostgrestError(error, 'conversation');
    }

    return {
      conversations: data.map(toConversation),
      total: count ?? data.length,
    };
  }

  async create(
    userId: string,
    input: CreateConversation,
  ): Promise<Conversation> {
    const { data, error } = await this.supabase.db
      .from('conversations')
      .insert({
        user_id: userId,
        ...(input.title === undefined ? {} : { title: input.title }),
      })
      .select(CONVERSATION_COLUMNS)
      .single();

    if (error) {
      throwPostgrestError(error, 'conversation');
    }

    return toConversation(data);
  }

  async findOne(id: string): Promise<Conversation> {
    const { data, error } = await this.supabase.db
      .from('conversations')
      .select(CONVERSATION_COLUMNS)
      .eq('id', id)
      .single();

    if (error) {
      throwPostgrestError(error, 'conversation');
    }

    return toConversation(data);
  }

  async findOneWithMessages(id: string): Promise<ConversationDetail> {
    const conversation = await this.findOne(id);

    return { ...conversation, messages: await this.messages(id) };
  }

  async messages(conversationId: string): Promise<ConversationMessage[]> {
    const { data, error } = await this.supabase.db
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId)
      // `seq` rather than `created_at`: turns written in one round trip can
      // share a timestamp, and a transcript out of order is nonsense.
      .order('seq', { ascending: true });

    if (error) {
      throwPostgrestError(error, 'message');
    }

    return data.map(toMessage);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.db
      .from('conversations')
      .delete()
      .eq('id', id)
      .select('id')
      .single();

    if (error) {
      throwPostgrestError(error, 'conversation');
    }
  }

  async appendUserMessage(
    conversationId: string,
    userId: string,
    content: string,
  ): Promise<ConversationMessage> {
    return this.insertMessage({
      conversation_id: conversationId,
      user_id: userId,
      role: 'user',
      content,
    });
  }

  async appendAssistantMessage(
    conversationId: string,
    userId: string,
    answer: {
      content: string;
      model: string;
      usage: TokenUsage | null;
      chunks: RetrievedChunk[];
    },
  ): Promise<ConversationMessage> {
    const message = await this.insertMessage({
      conversation_id: conversationId,
      user_id: userId,
      role: 'assistant',
      content: answer.content,
      model: answer.model,
      prompt_tokens: answer.usage?.promptTokens ?? null,
      completion_tokens: answer.usage?.completionTokens ?? null,
    });

    const citations = await this.insertCitations(
      message.id,
      userId,
      answer.chunks,
    );

    // Touching the parent keeps the sidebar ordered by real activity; the
    // trigger supplies the timestamp.
    await this.supabase.db
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    return { ...message, citations };
  }

  /**
   * Names a new conversation after its first question.
   *
   * Only when the title is still the default, so a user's own name for it is
   * never overwritten.
   */
  async titleFromFirstQuestion(
    conversationId: string,
    question: string,
  ): Promise<void> {
    const { error } = await this.supabase.db
      .from('conversations')
      .update({ title: toTitle(question) })
      .eq('id', conversationId)
      .eq('title', 'New conversation');

    if (error) {
      throwPostgrestError(error, 'conversation');
    }
  }

  private async insertMessage(row: {
    conversation_id: string;
    user_id: string;
    role: MessageRole;
    content: string;
    model?: string | null;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
  }): Promise<ConversationMessage> {
    const { data, error } = await this.supabase.db
      .from('messages')
      .insert(row)
      .select(MESSAGE_WITHOUT_CITATIONS)
      .single();

    if (error) {
      throwPostgrestError(error, 'message');
    }

    return toMessage({ ...data, message_citations: [] });
  }

  private async insertCitations(
    messageId: string,
    userId: string,
    chunks: RetrievedChunk[],
  ): Promise<Citation[]> {
    if (chunks.length === 0) {
      return [];
    }

    const rows = chunks.map((chunk, index) => ({
      message_id: messageId,
      user_id: userId,
      rank: index + 1,
      chunk_id: chunk.chunkId,
      document_id: chunk.documentId,
      // Snapshotted, not joined: the answer must stay explicable after the
      // source is edited or deleted.
      document_title: chunk.documentTitle,
      excerpt: chunk.content.slice(0, EXCERPT_LENGTH),
      similarity: chunk.similarity,
    }));

    const { data, error } = await this.supabase.db
      .from('message_citations')
      .insert(rows)
      .select('rank, document_id, document_title, excerpt, similarity');

    if (error) {
      throwPostgrestError(error, 'citation');
    }

    return data.map(toCitation);
  }
}

interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface CitationRow {
  rank: number;
  document_id: string | null;
  document_title: string;
  excerpt: string;
  similarity: number;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: string;
  message_citations?: CitationRow[] | null;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCitation(row: CitationRow): Citation {
  return {
    rank: row.rank,
    documentId: row.document_id,
    documentTitle: row.document_title,
    excerpt: row.excerpt,
    similarity: row.similarity,
  };
}

function toMessage(row: MessageRow): ConversationMessage {
  const promptTokens = row.prompt_tokens;
  const completionTokens = row.completion_tokens;

  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    createdAt: row.created_at,
    model: row.model,
    usage:
      promptTokens === null || completionTokens === null
        ? null
        : {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
          },
    citations: [...(row.message_citations ?? [])]
      .sort((a, b) => a.rank - b.rank)
      .map(toCitation),
  };
}

function toTitle(question: string): string {
  const flattened = question.replace(/\s+/g, ' ').trim();

  return flattened.length <= TITLE_LENGTH
    ? flattened
    : `${flattened.slice(0, TITLE_LENGTH - 1).trimEnd()}…`;
}
