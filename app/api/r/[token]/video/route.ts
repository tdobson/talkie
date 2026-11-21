import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { guarded, notFound } from '@/lib/review/http';
import { parseRange, resolveToken } from '@/lib/review/service';
import { sourcePath } from '@/lib/storage/paths';

type Ctx = { params: Promise<{ token: string }> };

const BASE_HEADERS = {
  'Accept-Ranges': 'bytes',
  'Content-Type': 'video/mp4',
  'Cache-Control': 'private, max-age=3600',
};

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** GET /api/r/<token>/video?version=<n>: the source video, with HTTP Range support. */
export function GET(req: Request, { params }: Ctx): Promise<Response> {
  return guarded(async () => {
    const { token } = await params;
    const video = await resolveToken(token);
    if (video === null) return notFound();

    const wanted = new URL(req.url).searchParams.get('version') ?? '';
    const version = /^\d{1,6}$/.test(wanted) ? Number(wanted) : null;
    if (version === null || !video.versions.some((v) => v.version === version)) return notFound();

    const path = sourcePath(video.videoId, version);
    const size = await fileSize(path);
    if (size === null) return notFound();

    const range = parseRange(req.headers.get('range'), size);
    if (range === 'invalid') {
      return new Response(null, {
        status: 416,
        headers: { ...BASE_HEADERS, 'Content-Range': `bytes */${size}` },
      });
    }
    if (size === 0) {
      return new Response(null, {
        status: 200,
        headers: { ...BASE_HEADERS, 'Content-Length': '0' },
      });
    }

    const { start, end } = range ?? { start: 0, end: size - 1 };
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      'Content-Length': String(end - start + 1),
    };
    if (range !== null) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(body, { status: range === null ? 200 : 206, headers });
  });
}
