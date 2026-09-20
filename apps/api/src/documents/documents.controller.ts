import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createDocumentSchema,
  listDocumentsQuerySchema,
  updateDocumentSchema,
  type AuthenticatedUser,
  type CreateDocument,
  type Document,
  type DocumentList,
  type ListDocumentsQuery,
  type UpdateDocument,
} from '@repo/contracts';

import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listDocumentsQuerySchema))
    query: ListDocumentsQuery,
  ): Promise<DocumentList> {
    return this.documents.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Document> {
    return this.documents.findOne(id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createDocumentSchema)) body: CreateDocument,
  ): Promise<Document> {
    return this.documents.create(user.id, body);
  }

  /** Retries embedding after a failure, without changing the document. */
  @Post(':id/reindex')
  @HttpCode(HttpStatus.OK)
  reindex(@Param('id', ParseUUIDPipe) id: string): Promise<Document> {
    return this.documents.reindex(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateDocumentSchema)) body: UpdateDocument,
  ): Promise<Document> {
    return this.documents.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.documents.remove(id);
  }
}
