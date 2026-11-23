import type { NextApiRequest, NextApiResponse } from 'next';
import { serveMedia } from '@/lib/review/media-api';
import { getFilmFile } from '@/lib/review/media-handlers';

// GET /api/r/<token>/film/<version>/<path...>. A Pages Router route, not an App Router one, so
// the narration keeps its Content-Length: see lib/review/media-handlers.ts.

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
  const { token, version, path } = req.query;
  const segments = Array.isArray(path) ? path : path === undefined ? undefined : [path];
  return serveMedia(req, res, (web) =>
    getFilmFile(web, String(token ?? ''), String(version ?? ''), segments)
  );
}
