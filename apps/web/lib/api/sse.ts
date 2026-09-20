/**
 * Reads a `text/event-stream` body as parsed `data:` payloads.
 *
 * Network chunks do not respect frame boundaries — one read can hold half an
 * event, or three — so the buffer is split on the blank line that terminates a
 * frame and any remainder is carried into the next read.
 */
export async function* readServerSentEvents<T>(
  response: Response,
): AsyncGenerator<T> {
  const body = response.body;

  if (!body) {
    return;
  }

  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += value;

      let boundary = buffer.indexOf('\n\n');

      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const payload = toPayload(frame);

        if (payload !== null) {
          yield payload as T;
        }

        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    // Releasing matters when the consumer breaks out early, which a component
    // unmounting mid-answer will do.
    reader.releaseLock();
  }
}

function toPayload(frame: string): unknown {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('\n');

  if (data === '') {
    return null;
  }

  try {
    return JSON.parse(data);
  } catch {
    // A malformed frame is worth skipping rather than killing the stream.
    return null;
  }
}
