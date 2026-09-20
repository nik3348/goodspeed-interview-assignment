import { Injectable, Logger } from '@nestjs/common';
import type OpenAI from 'openai';

import type { ChatModel } from '../chat-model';
import type {
  ChatCompletion,
  ChatRequest,
  ChatStreamEvent,
  FinishReason,
  TokenUsage,
} from '../messages';

import { toAiError } from './openai-error';

/**
 * A chat model reached over the OpenAI wire format.
 *
 * This class is the only place in the codebase aware of OpenAI's request and
 * response shapes. Because Groq, Together, OpenRouter and Ollama all implement
 * the same format, one adapter serves all of them and the choice is a base URL.
 */
@Injectable()
export class OpenAiChatModel implements ChatModel {
  private readonly logger = new Logger(OpenAiChatModel.name);

  constructor(
    private readonly client: OpenAI,
    readonly model: string,
  ) {}

  async complete(request: ChatRequest): Promise<ChatCompletion> {
    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: request.messages,
          ...(request.temperature === undefined
            ? {}
            : { temperature: request.temperature }),
          ...(request.maxOutputTokens === undefined
            ? {}
            : { max_tokens: request.maxOutputTokens }),
          stream: false,
        },
        { signal: request.signal },
      );

      const choice = response.choices[0];

      if (!choice) {
        this.logger.warn(`${this.model} returned no choices`);
      }

      return {
        content: choice?.message.content ?? '',
        model: response.model || this.model,
        finishReason: toFinishReason(choice?.finish_reason),
        usage: toTokenUsage(response.usage),
      };
    } catch (error) {
      throw toAiError(error);
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    let content = '';
    let model = this.model;
    let finishReason: FinishReason = 'other';
    let usage: TokenUsage | null = null;

    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: request.messages,
          ...(request.temperature === undefined
            ? {}
            : { temperature: request.temperature }),
          ...(request.maxOutputTokens === undefined
            ? {}
            : { max_tokens: request.maxOutputTokens }),
          stream: true,
          // Providers that support it report usage on the final chunk. Those
          // that do not simply ignore the option, leaving usage null.
          stream_options: { include_usage: true },
        },
        { signal: request.signal },
      );

      for await (const chunk of stream) {
        model = chunk.model || model;
        usage = toTokenUsage(chunk.usage) ?? usage;

        const choice = chunk.choices[0];

        if (choice?.finish_reason) {
          finishReason = toFinishReason(choice.finish_reason);
        }

        const text = choice?.delta?.content;

        if (text) {
          content += text;
          yield { type: 'delta', text };
        }
      }
    } catch (error) {
      throw toAiError(error);
    }

    // One terminal event, so a consumer that ignored the deltas still ends up
    // with the same value `complete()` would have returned.
    yield {
      type: 'done',
      completion: { content, model, finishReason, usage },
    };
  }
}

function toFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'other';
  }
}

function toTokenUsage(
  usage: OpenAI.CompletionUsage | null | undefined,
): TokenUsage | null {
  if (!usage) {
    return null;
  }

  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens:
      usage.total_tokens ??
      (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
  };
}
