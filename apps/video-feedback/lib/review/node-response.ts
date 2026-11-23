import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';

// The bridge between a Pages Router API route and a handler written for the App Router (a web
// Request in, a web Response out). It exists for one header: an App Router route cannot send
// Content-Length (Next drops it), and Safari needs it to seek in a video or a narration track.

/** The Node request as a web Request, enough for a GET handler: method, URL and headers. */
export function toWebRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
  }
  // Only the path and query are used; the host is a placeholder so the URL parses.
  return new Request(new URL(req.url ?? '/', 'http://localhost'), {
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
  });
}

/**
 * Writes a web Response to the Node response with every header it carries, Content-Length
 * included. A HEAD request gets the headers and no body. A reader that goes away mid-file (a
 * seek abandons the old range) only stops the stream: it is not an error.
 */
export async function sendWebResponse(
  req: IncomingMessage,
  res: ServerResponse,
  response: Response
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  const body = response.body;
  if (body === null || req.method === 'HEAD') {
    await body?.cancel();
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(body as unknown as NodeWebStream<Uint8Array>), res);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ERR_STREAM_PREMATURE_CLOSE' || res.destroyed) return;
    throw err;
  }
}
