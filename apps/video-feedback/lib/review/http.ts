import { limits } from '@/lib/limits';
import { ReviewInputError, ReviewLimitError } from './service';

// Small helpers shared by the reviewer route handlers under `app/api/r/[token]`.

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** The one answer for an unknown token, session, comment or version. It gives no detail. */
export function notFound(): Response {
  return json({ error: 'not found' }, 404);
}

/**
 * Reads a JSON request body, holding it to `limits.jsonBodyBytes`: these bodies are a few
 * hundred bytes, and `req.json()` alone would buffer whatever the proxy lets through.
 * Anything unreadable becomes a 400 through `guarded`, anything too large a 413.
 */
export async function readJsonBody(req: Request): Promise<unknown> {
  let bytes: Uint8Array | null;
  try {
    bytes = await readBodyCapped(req, limits.jsonBodyBytes);
  } catch {
    throw new ReviewInputError('Body must be JSON.');
  }
  if (bytes === null) throw new ReviewLimitError('Body is too large.', 413);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ReviewInputError('Body must be JSON.');
  }
}

/** The client address as Cloudflare reports it, or null when not behind the tunnel. */
export function clientIp(req: Request): string | null {
  return req.headers.get('cf-connecting-ip');
}

/** Runs a handler, turning input errors into 400 and anything unexpected into a bare 500. */
export async function guarded(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ReviewInputError) return json({ error: err.message }, 400);
    if (err instanceof ReviewLimitError) return json({ error: err.message }, err.status);
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
