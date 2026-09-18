import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiError } from '@repo/contracts';
import type { Request, Response } from 'express';

/**
 * Renders every failure as the shared {@link ApiError} envelope, so the web app
 * has one shape to narrow on. Unexpected errors are logged in full and reported
 * as a generic 500 — internals never reach the client.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const body = this.toApiError(exception);

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toApiError(exception: unknown): ApiError {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const payload = exception.getResponse();

      return {
        statusCode,
        code: toErrorCode(statusCode),
        message:
          typeof payload === 'string'
            ? payload
            : ((payload as { message?: string | string[] }).message instanceof
              Array
                ? (payload as { message: string[] }).message.join(', ')
                : (payload as { message?: string }).message) ??
              exception.message,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: toErrorCode(HttpStatus.INTERNAL_SERVER_ERROR),
      message: 'Something went wrong.',
    };
  }
}

/** `NOT_FOUND` -> `not_found`, giving clients a stable discriminator. */
function toErrorCode(statusCode: number): string {
  const name = Object.entries(HttpStatus).find(
    ([, value]) => value === statusCode,
  )?.[0];

  return name ? name.toLowerCase() : 'error';
}
