import { ReviewInputError } from './service';

// Small helpers shared by the reviewer route handlers under `app/api/r/[token]`.

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** The one answer for an unknown token, session, comment or version. It gives no detail. */
export function notFound(): Response {
  return json({ error: 'not found' }, 404);
}

/** Reads a JSON request body. Anything unreadable becomes a 400 through `guarded`. */
export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ReviewInputError('Body must be JSON.');
  }
}

/** Runs a handler, turning input errors into 400 and anything unexpected into a bare 500. */
export async function guarded(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ReviewInputError) return json({ error: err.message }, 400);
    console.error('Reviewer API error.', err);
    return json({ error: 'server error' }, 500);
  }
}

/**
 * Reads a request body into memory, giving up as soon as it passes `maxBytes`. Returns null
 * when it is too large. The declared Content-Length is only a shortcut: the bytes are counted
 * as they arrive, so a body with no length, or a wrong one, is held to the same limit.
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return null;
  if (req.body === null) return new Uint8Array(0);

  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
