import { createReadStream } from 'node:fs';
import { lstat, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { mediaKindOf } from '@/lib/media-kind';
import type { MediaKind, VideoRecord } from '@/lib/types';
import { notFound } from './http';
import { parseRange, resolveToken } from './service';

// Shared by the routes that serve a version's media to the reviewer: `video` for an MP4 version
// and `film/<path>` for a Talkie version. Both make the same token and version checks, here.

export interface MediaVersion {
  video: VideoRecord;
  version: number;
  kind: MediaKind;
}

/**
 * The video behind `token` and the version named by `?version=<n>`, or null when the link is not
 * valid or that version is not on the video. The caller answers null with `notFound()`.
 */
export async function resolveMediaVersion(
  req: Request,
  token: string
): Promise<MediaVersion | null> {
  const video = await resolveToken(token);
  if (video === null) return null;

  const wanted = new URL(req.url).searchParams.get('version') ?? '';
  const version = /^\d{1,6}$/.test(wanted) ? Number(wanted) : null;
  const record = video.versions.find((v) => v.version === version);
  if (version === null || record === undefined) return null;
  return { video, version, kind: mediaKindOf(record) };
}

/** Size of a regular file, or null. With `links: 'refuse'` a symbolic link is not a regular file. */
async function fileSize(path: string, links: 'follow' | 'refuse'): Promise<number | null> {
  try {
    const info = await (links === 'follow' ? stat(path) : lstat(path));
    return info.isFile() ? info.size : null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
}

/**
 * Serves one file with HTTP Range support: 200 for the whole file, 206 for a range, 416 for a
 * range that cannot be met, 404 when the file is not there. Symbolic links are not served unless
 * `links` is `'follow'`.
 */
export async function serveFile(
  req: Request,
  path: string,
  typeHeaders: Record<string, string>,
  links: 'follow' | 'refuse' = 'refuse'
): Promise<Response> {
  const size = await fileSize(path, links);
  if (size === null) return notFound();

  const base = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    ...typeHeaders,
  };
  const range = parseRange(req.headers.get('range'), size);
  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: { ...base, 'Content-Range': `bytes */${size}` },
    });
  }
  if (size === 0) {
    return new Response(null, { status: 200, headers: { ...base, 'Content-Length': '0' } });
  }

  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
  const headers: Record<string, string> = { ...base, 'Content-Length': String(end - start + 1) };
  if (range !== null) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: range === null ? 200 : 206, headers });
}
