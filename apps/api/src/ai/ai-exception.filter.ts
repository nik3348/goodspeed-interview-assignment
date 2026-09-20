import {
  Catch,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiError } from '@repo/contracts';
import type { Response } from 'express';

import {
  AiAuthenticationError,
  AiCancelledError,
  AiConfigurationError,
  AiContextLengthError,
  AiError,
  AiRateLimitError,
} from './ai.errors';

/** Nginx's convention for "the client went away mid-request". */
const CLIENT_CLOSED_REQUEST = 499;

/**
 * Turns a provider failure into an HTTP response.
 *
 * The distinction that matters: a rejected API key or an unreachable provider
 * is *our* problem and must not be reported as a client error, while an
 * oversized prompt genuinely is the caller's and should be actionable.
 */
@Catch(AiError)
export class AiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AiExceptionFilter.name);

  catch(exception: AiError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = toApiError(exception);

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${exception.name}: ${exception.message}`,
        exception.cause,
      );
    }

    if (response.headersSent) {
      // A stream was already flowing, so the status line is long gone. Ending
      // the response is the only signal left to send.
      response.end();
      return;
    }

    response.status(body.statusCode).json(body);
  }
}

function toApiError(exception: AiError): ApiError {
  if (exception instanceof AiContextLengthError) {
    return {
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      code: 'context_length_exceeded',
      message: exception.message,
    };
  }

  if (exception instanceof AiRateLimitError) {
    return {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      code: 'ai_rate_limited',
      message: 'The assistant is busy right now. Try again shortly.',
    };
  }

  if (exception instanceof AiCancelledError) {
    return {
      statusCode: CLIENT_CLOSED_REQUEST,
      code: 'request_cancelled',
      message: exception.message,
    };
  }

  if (
    exception instanceof AiAuthenticationError ||
    exception instanceof AiConfigurationError
  ) {
    // Misconfiguration on our side: log the detail, tell the caller nothing.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'ai_misconfigured',
      message: 'The assistant is not configured correctly.',
    };
  }

  return {
    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
    code: 'ai_unavailable',
    message: 'The assistant is temporarily unavailable.',
  };
}
