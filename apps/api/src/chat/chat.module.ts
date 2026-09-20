import { Module } from '@nestjs/common';

import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationsService } from './conversations.service';
import { RetrievalService } from './retrieval.service';

@Module({
  controllers: [ChatController],
  providers: [ChatService, ConversationsService, RetrievalService],
  exports: [ConversationsService, RetrievalService],
})
export class ChatModule {}
