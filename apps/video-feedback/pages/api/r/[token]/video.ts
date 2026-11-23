import type { NextApiRequest, NextApiResponse } from 'next';
import { getVideo } from '@/lib/review/media-handlers';
import { serveMedia } from '@/lib/review/media-api';

// GET /api/r/<token>/video?version=<n>. A Pages Router route, not an App Router one, so the
// response keeps its Content-Length: see lib/review/media-handlers.ts.

export const config = {
  api: {
    // Nothing is read from the body, and a video is far bigger than the 4 MB default limit.
    bodyParser: false,
    responseLimit: false,
    // The response is finished by a stream pipeline, after the handler has returned.
    externalResolver: true,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  return serveMedia(req, res, (web) => getVideo(web, String(req.query.token ?? '')));
}
