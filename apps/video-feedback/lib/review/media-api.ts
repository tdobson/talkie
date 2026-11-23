import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendWebResponse, toWebRequest } from './node-response';

/**
 * Runs a media handler for one of the two Pages Router media routes: GET and HEAD only. (Their
 * `config` has to be a literal in each route file, as Next reads it without running the code.)
 */
export async function serveMedia(
  req: IncomingMessage,
  res: ServerResponse,
  handle: (web: Request) => Promise<Response>
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end();
    return;
  }
  await sendWebResponse(req, res, await handle(toWebRequest(req)));
}
