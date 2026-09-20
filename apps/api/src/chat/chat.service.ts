import { Inject, Injectable } from '@nestjs/common';
import type {
  Answer,
  AskQuestion,
  Citation,
  ConversationMessage,
} from '@repo/contracts';

import { CHAT_MODEL, type ChatModel } from '../ai/chat-model';
import type { ChatMessage, TokenUsage } from '../ai/messages';
import { SupabaseUserClient } from '../supabase/supabase-user-client';

import { ConversationsService } from './conversations.service';
import { buildPrompt } from './prompt';
import { RetrievalService, type RetrievedChunk } from './retrieval.service';

/**
 * Low, because the job is to report what the sources say rather than to write
 * something interesting. Not zero: some providers behave oddly at exactly 0.
 */
const TEMPERATURE = 0.2;

/** Turns of history fed back into retrieval to resolve pronouns. */
const HISTORY_FOR_RETRIEVAL = 2;

/** The model's output, before it is persisted. */
interface AnswerDraft {
  content: string;
  model: string;
  usage: TokenUsage | null;
}

/** What both answer paths need before the model is called. */
interface PreparedTurn {
  userMessage: ConversationMessage;
  messages: ChatMessage[];
  chunks: RetrievedChunk[];
  citations: Citation[];
}

/**
 * Answers a question against the user's own documents.
 *
 * The two entry points share everything except how the model's output is
 * consumed: `prepare` does retrieval, prompt construction and persistence of
 * the question, and `finish` persists the answer with its sources. Streaming
 * is therefore not a second implementation of the pipeline, which is what
 * usually causes the two to drift.
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(CHAT_MODEL) private readonly model: ChatModel,
    private readonly retrieval: RetrievalService,
    private readonly conversations: ConversationsService,
    private readonly supabase: SupabaseUserClient,
  ) {}

  async ask(conversationId: string, input: AskQuestion): Promise<Answer> {
    const prepared = await this.prepare(conversationId, input);

    const completion = await this.model.complete({
      messages: prepared.messages,
      temperature: TEMPERATURE,
    });

    const assistantMessage = await this.finish(conversationId, prepared, {
      content: completion.content,
      model: completion.model,
      usage: completion.usage,
    });

    return {
      conversation: await this.conversations.findOne(conversationId),
      userMessage: prepared.userMessage,
      assistantMessage,
    };
  }

  /**
   * Streams the answer.
   *
   * Citations are yielded before the first token: retrieval has already
   * finished by then, so the sources can be on screen while the text arrives.
   */
  async *askStreaming(
    conversationId: string,
    input: AskQuestion,
  ): AsyncGenerator<
    | { type: 'citations'; citations: Citation[] }
    | { type: 'delta'; text: string }
    | { type: 'done'; assistantMessage: ConversationMessage }
  > {
    const prepared = await this.prepare(conversationId, input);

    yield { type: 'citations', citations: prepared.citations };

    let answer: AnswerDraft = {
      content: '',
      model: this.model.model,
      usage: null,
    };

    for await (const event of this.model.stream({
      messages: prepared.messages,
      temperature: TEMPERATURE,
    })) {
      if (event.type === 'delta') {
        yield { type: 'delta', text: event.text };
      } else {
        answer = {
          content: event.completion.content,
          model: event.completion.model,
          usage: event.completion.usage,
        };
      }
    }

    const assistantMessage = await this.finish(
      conversationId,
      prepared,
      answer,
    );

    yield { type: 'done', assistantMessage };
  }

  private async prepare(
    conversationId: string,
    input: AskQuestion,
  ): Promise<PreparedTurn> {
    // Reads the conversation first so a bad id fails before anything is
    // written or any provider is billed.
    await this.conversations.findOne(conversationId);

    const history = await this.conversations.messages(conversationId);

    const chunks = await this.retrieval.retrieve(input.question, {
      ...(input.documentIds === undefined
        ? {}
        : { documentIds: input.documentIds }),
      history: history
        .slice(-HISTORY_FOR_RETRIEVAL)
        .map((message) => message.content),
    });

    const { messages, citedChunks } = buildPrompt({
      question: input.question,
      chunks,
      history: history.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });

    const userMessage = await this.conversations.appendUserMessage(
      conversationId,
      this.supabase.userId,
      input.question,
    );

    if (history.length === 0) {
      await this.conversations.titleFromFirstQuestion(
        conversationId,
        input.question,
      );
    }

    return {
      userMessage,
      messages,
      chunks: citedChunks,
      citations: citedChunks.map(toCitation),
    };
  }

  private async finish(
    conversationId: string,
    prepared: PreparedTurn,
    answer: AnswerDraft,
  ): Promise<ConversationMessage> {
    return this.conversations.appendAssistantMessage(
      conversationId,
      this.supabase.userId,
      { ...answer, chunks: prepared.chunks },
    );
  }
}

function toCitation(chunk: RetrievedChunk, index: number): Citation {
  return {
    rank: index + 1,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    excerpt: chunk.content.slice(0, 320),
    similarity: chunk.similarity,
  };
}
