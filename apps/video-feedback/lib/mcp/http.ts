import type { AccessIdentity } from '@/lib/auth/access';
import { config } from '@/lib/config';
import {
  ERRORS,
  handleRequest,
  isRequest,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpServer,
  rpcError,
  toolFor,
} from './server';
import type { ToolContext } from './types';

// MCP's Streamable HTTP transport, stateless: one POST per message. Most answers are plain JSON.
// A long tool (waiting for feedback) is answered as an event stream instead, so the response
// starts at once and keep-alives hold it open through Caddy and Cloudflare for as long as the
// tool waits.

/** Largest request body read. Tool arguments are small; a film never travels this way. */
export const MAX_BODY_BYTES = 256 * 1024;

/** Most messages in one batch (only clients older than 2025-06-18 send batches). */
export const MAX_BATCH = 10;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export interface HttpOptions {
  /** How often a waiting stream sends a keep-alive comment. */
  keepAliveMs?: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function wantsStream(req: Request): boolean {
  return (req.headers.get('accept') ?? '').includes('text/event-stream');
}

function baseUrl(): string {
  return config().publicBaseUrl.replace(/\/+$/, '');
}

function context(
  identity: AccessIdentity | null,
  signal: AbortSignal,
  progress: ToolContext['progress'] = () => {}
): ToolContext {
  return { identity, baseUrl: baseUrl(), signal, progress };
}

/** Answers one request as an event stream: keep-alives while it runs, then the result. */
function streamed(
  server: McpServer,
  msg: JsonRpcRequest & { id: string | number },
  identity: AccessIdentity | null,
  reqSignal: AbortSignal,
  keepAliveMs: number
): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  reqSignal.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const meta = (msg.params?._meta ?? {}) as Record<string, unknown>;
  const token = meta.progressToken;
  const hasToken = typeof token === 'string' || typeof token === 'number';
  let step = 0;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };
      const event = (message: unknown) =>
        send(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
      // The first bytes go out at once: proxies and clients time out a silent response.
      send(': waiting\n\n');
      timer = setInterval(() => send(': keep-alive\n\n'), keepAliveMs);
      const progress = (message: string) => {
        if (!hasToken) return;
        step += 1;
        event({
          jsonrpc: '2.0',
          method: 'notifications/progress',
          params: { progressToken: token, progress: step, message },
        });
      };
      handleRequest(server, msg, context(identity, abort.signal, progress))
        .catch((err: unknown): JsonRpcResponse => {
          console.error('[mcp] request failed:', err);
          return rpcError(msg.id, ERRORS.internal, 'Internal error.');
        })
        .then((response) => {
          event(response);
          clearInterval(timer);
          reqSignal.removeEventListener('abort', onAbort);
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
      clearInterval(timer);
      abort.abort();
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      // no-transform: the server's gzip must not hold the stream back to compress it.
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** POST /api/admin/mcp, after the admin check. */
export async function mcpPost(
  req: Request,
  server: McpServer,
  identity: AccessIdentity | null,
  opts: HttpOptions = {}
): Promise<Response> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    return json(rpcError(null, ERRORS.invalidRequest, 'The request is too large.'), 413);
  }
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return json(rpcError(null, ERRORS.invalidRequest, 'The request is too large.'), 413);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json(rpcError(null, ERRORS.parse, 'Parse error.'), 400);
  }

  // Batches are from older clients. Their requests are answered together, as JSON.
  if (Array.isArray(parsed)) {
    // A few quick calls at most: a long wait is never answered inside a batch (it could not
    // stream, and Cloudflare would cut it off), and a big batch would only load the server.
    if (parsed.length > MAX_BATCH) {
      return json(
        rpcError(null, ERRORS.invalidRequest, `At most ${MAX_BATCH} messages in a batch.`),
        400
      );
    }
    if (parsed.some((item) => isRequest(item) && toolFor(server, item)?.longRunning)) {
      return json(
        rpcError(
          null,
          ERRORS.invalidRequest,
          'Send a long-running call on its own, not in a batch.'
        ),
        400
      );
    }
    const answers: JsonRpcResponse[] = [];
    for (const item of parsed) {
      if (isRequest(item))
        answers.push(await handleRequest(server, item, context(identity, req.signal)));
    }
    return answers.length === 0 ? new Response(null, { status: 202 }) : json(answers);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return json(rpcError(null, ERRORS.invalidRequest, 'Invalid request.'), 400);
  }
  // A notification or a response from the client needs no answer.
  if (!isRequest(parsed)) {
    const m = parsed as Record<string, unknown>;
    if (typeof m.method === 'string' || 'result' in m || 'error' in m) {
      return new Response(null, { status: 202 });
    }
    return json(rpcError(null, ERRORS.invalidRequest, 'Invalid request.'), 400);
  }

  if (toolFor(server, parsed)?.longRunning && wantsStream(req)) {
    return streamed(server, parsed, identity, req.signal, opts.keepAliveMs ?? 15_000);
  }
  return json(await handleRequest(server, parsed, context(identity, req.signal)));
}

/** GET and DELETE: there are no sessions and no server-sent stream to open. */
export function mcpMethodNotAllowed(): Response {
  return new Response(JSON.stringify({ error: 'Use POST.' }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: 'POST' },
  });
}
