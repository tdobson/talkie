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
