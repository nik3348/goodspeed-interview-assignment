import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates a handler argument against a schema from `@repo/contracts`.
 *
 * Nest's stock `ValidationPipe` infers rules from `class-validator` decorators,
 * which would mean describing every payload twice: once as a decorated class
 * for the API, once as a type for the web app. Parsing with the shared zod
 * schema instead makes the contract package the single definition, and the web
 * app can validate the same payload before it ever leaves the browser.
 *
 * @example
 * create(@Body(new ZodValidationPipe(createDocumentSchema)) body: CreateDocument)
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      // An array of messages; `ApiExceptionFilter` joins them into one string.
      throw new BadRequestException(
        result.error.issues.map(
          (issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`,
        ),
      );
    }

    return result.data;
  }
}
