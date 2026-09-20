import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { apiErrorSchema } from '@repo/contracts';
import request from 'supertest';

import { AppModule } from './../src/app.module';

describe('API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the health check without a session', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200, { status: 'ok' });
  });

  it('rejects a protected route with no bearer token', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('rejects a protected route with a malformed bearer token', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
  });

  // The guard is global, so a new controller is protected by default. These
  // assert that nothing in the documents module opted out by accident.
  describe.each([
    ['get', '/documents'],
    ['get', '/documents/3f6a1c9e-1111-4a7b-9c2d-000000000001'],
    ['post', '/documents'],
    ['patch', '/documents/3f6a1c9e-1111-4a7b-9c2d-000000000001'],
    ['delete', '/documents/3f6a1c9e-1111-4a7b-9c2d-000000000001'],
    ['get', '/conversations'],
    ['post', '/conversations'],
    ['get', '/conversations/3f6a1c9e-1111-4a7b-9c2d-000000000001'],
    ['delete', '/conversations/3f6a1c9e-1111-4a7b-9c2d-000000000001'],
    ['post', '/conversations/3f6a1c9e-1111-4a7b-9c2d-000000000001/messages'],
    [
      'post',
      '/conversations/3f6a1c9e-1111-4a7b-9c2d-000000000001/messages/stream',
    ],
  ] as const)('%s %s', (method, path) => {
    it('requires a session', () => {
      return request(app.getHttpServer())[method](path).expect(401);
    });
  });

  it('answers an unknown route with the shared error envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/nope')
      .expect(404);

    expect(apiErrorSchema.safeParse(response.body).success).toBe(true);
  });
});
