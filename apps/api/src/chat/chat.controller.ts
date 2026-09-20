import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  askQuestionSchema,
  createConversationSchema,
  type Answer,
  type AskQuestion,
  type AuthenticatedUser,
  type Conversation,
  type ConversationDetail,
  type ConversationList,
  type CreateConversation,
} from '@repo/contracts';
import type { Response } from 'express';

import { AiError } from '../ai/ai.errors';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

import { ChatService } from './chat.service';
import { ConversationsService } from './conversations.service';

@Controller('conversations')
export class ChatController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly chat: ChatService,
  ) {}

  @Get()
  list(): Promise<ConversationList> {
    return this.conversations.list();
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createConversationSchema))
    body: CreateConversation,
  ): Promise<Conversation> {
    return this.conversations.create(user.id, body);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationDetail> {
    return this.conversations.findOneWithMessages(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.conversations.remove(id);
  }

  @Post(':id/messages')
  ask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(askQuestionSchema)) body: AskQuestion,
  ): Promise<Answer> {
    return this.chat.ask(id, body);
  }

  /**
   * The same answer, streamed as server-sent events.
   *
   * Written to the response directly rather than through Nest's `@Sse`
   * decorator because the turn has to be persisted after the last token, and
   * the failure mode matters: once headers are sent the status code is already
   * committed, so an error becomes a final `error` event instead.
   */
  @Post(':id/messages/stream')
  async askStreaming(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(askQuestionSchema)) body: AskQuestion,
    @Res() response: Response,
  ): Promise<void> {
    response.writeHead(HttpStatus.OK, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells nginx and friends not to buffer, which would defeat the point.
      'X-Accel-Buffering': 'no',
    });

    try {
      for await (const event of this.chat.askStreaming(id, body)) {
        write(response, event);
      }
    } catch (error) {
      write(response, {
        type: 'error',
        message:
          error instanceof AiError
            ? error.message
            : 'Something went wrong while answering.',
      });
    } finally {
      response.end();
    }
  }
}

function write(response: Response, event: unknown): void {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}
