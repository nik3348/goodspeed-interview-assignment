import {
  BadRequestException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { apiErrorSchema } from '@repo/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ApiExceptionFilter } from './api-exception.filter';

function createHost() {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));

  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/documents' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('ApiExceptionFilter', () => {
  let filter: ApiExceptionFilter;

  beforeEach(() => {
    filter = new ApiExceptionFilter();
  });

  it('renders an HTTP exception as the shared envelope', () => {
    const { host, status, json } = createHost();

    filter.catch(new NotFoundException('No such document.'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      code: 'not_found',
      message: 'No such document.',
    });
  });

  it("joins the validation pipe's list of messages", () => {
    const { host, json } = createHost();

    filter.catch(
      new BadRequestException(['title must be a string', 'title is required']),
      host,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'title must be a string, title is required',
      }),
    );
  });

  it('hides the detail of an unexpected error', () => {
    const { host, status, json } = createHost();
    // The filter logs the real error; the client must not see it.
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

    filter.catch(new Error('connection string: postgres://user:pw@host'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      code: 'internal_server_error',
      message: 'Something went wrong.',
    });
  });

  it('always emits a body that matches the published contract', () => {
    const { host, json } = createHost();

    filter.catch(new NotFoundException(), host);

    expect(apiErrorSchema.safeParse(json.mock.calls[0]?.[0]).success).toBe(
      true,
    );
  });
});
