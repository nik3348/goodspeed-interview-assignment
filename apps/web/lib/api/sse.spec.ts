/**
 * Web streams are native in Node but absent from the jsdom environment the
 * rest of this app's tests use, and this parser is environment-agnostic.
 *
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import { readServerSentEvents } from './sse';

/** Serves a body in exactly the pieces given, to control frame boundaries. */
function responseOf(...pieces: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      for (const piece of pieces) {
        controller.enqueue(encoder.encode(piece));
      }

      controller.close();
    },
  });

  return { body: stream } as unknown as Response;
}

async function collect<T>(response: Response): Promise<T[]> {
  const events: T[] = [];

  for await (const event of readServerSentEvents<T>(response)) {
    events.push(event);
  }

  return events;
}

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

describe('readServerSentEvents', () => {
  it('parses one frame per event', async () => {
    const response = responseOf(frame({ n: 1 }), frame({ n: 2 }));

    await expect(collect(response)).resolves.toEqual([{ n: 1 }, { n: 2 }]);
  });

  // The failure this function exists to prevent: a network read can end in the
  // middle of a frame, and a naive parser drops or corrupts it.
  it('reassembles a frame split across reads', async () => {
    const whole = frame({ text: 'mitochondria' });
    const response = responseOf(
      whole.slice(0, 9),
      whole.slice(9, 20),
      whole.slice(20),
    );

    await expect(collect(response)).resolves.toEqual([
      { text: 'mitochondria' },
    ]);
  });

  it('splits several frames delivered in one read', async () => {
    const response = responseOf(
      frame({ n: 1 }) + frame({ n: 2 }) + frame({ n: 3 }),
    );

    await expect(collect(response)).resolves.toEqual([
      { n: 1 },
      { n: 2 },
      { n: 3 },
    ]);
  });

  it('carries a partial frame into the following read', async () => {
    const response = responseOf(`${frame({ n: 1 })}data: {"n":`, '2}\n\n');

    await expect(collect(response)).resolves.toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('handles a multi-byte character straddling a read boundary', async () => {
    const encoded = new TextEncoder().encode(frame({ text: '£110 — fine' }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 12));
        controller.enqueue(encoded.slice(12));
        controller.close();
      },
    });

    await expect(
      collect({ body: stream } as unknown as Response),
    ).resolves.toEqual([{ text: '£110 — fine' }]);
  });

  it('joins a data payload spread over several lines', async () => {
    const response = responseOf('data: {"n":\ndata: 1}\n\n');

    await expect(collect(response)).resolves.toEqual([{ n: 1 }]);
  });

  it('ignores comments and other SSE fields', async () => {
    const response = responseOf(
      `:keep-alive\n\nevent: ping\n\n${frame({ n: 1 })}`,
    );

    await expect(collect(response)).resolves.toEqual([{ n: 1 }]);
  });

  // One bad frame should not end an answer that is otherwise arriving fine.
  it('skips a malformed frame and keeps going', async () => {
    const response = responseOf(`data: {not json}\n\n${frame({ n: 2 })}`);

    await expect(collect(response)).resolves.toEqual([{ n: 2 }]);
  });

  it('drops a trailing frame with no terminator', async () => {
    const response = responseOf(`${frame({ n: 1 })}data: {"n":2}`);

    await expect(collect(response)).resolves.toEqual([{ n: 1 }]);
  });

  it('yields nothing for a response with no body', async () => {
    await expect(
      collect({ body: null } as unknown as Response),
    ).resolves.toEqual([]);
  });
});
