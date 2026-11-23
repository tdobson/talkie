import { join } from 'node:path';
import { isSafeRelativePath, mimeFor, validateFilm } from '@talkie/format';
import { guarded, notFound } from '@/lib/review/http';
import { resolveMediaVersion, serveFile, serveGzippedFile } from '@/lib/review/media-route';
import { readJson } from '@/lib/storage/json';
import { filmDir, sourcePath } from '@/lib/storage/paths';
import { FILM_JSON, listedPaths } from '@/lib/videos/film';
import { locateFilmFile } from '@/lib/videos/film-files';

// The two reviewer media routes. They live here, not in app/api, because an App Router route
// cannot send Content-Length: Next drops it. Without it Safari treats a video or a narration
// track that arrives at internet speed as a live stream: no length, and no seeking at all. So
// pages/api serves these through `sendWebResponse`, which keeps the header.

/**
 * GET /api/r/<token>/video?version=<n>: the source video of an MP4 version, with HTTP Range
 * support. A Talkie version has no source video: its film is served by `getFilmFile`.
 */
export function getVideo(req: Request, token: string): Promise<Response> {
  return guarded(async () => {
    const media = await resolveMediaVersion(req, token);
    if (media === null || media.kind !== 'mp4') return notFound();
    // 'follow', as this route always has: a source.mp4 may be a link to a file kept elsewhere.
    const path = sourcePath(media.video.videoId, media.version);
    return serveFile(req, path, { 'Content-Type': 'video/mp4' }, 'follow');
  });
}

/**
 * A film file is only ever data for the player. If one is opened as a page of its own (an SVG
 * poster can carry script), it runs with nothing and reaches nothing.
 */
const LOCKED_DOWN = {
  'X-Content-Type-Options': 'nosniff',
  // This replaces the site-wide policy for these files, so it repeats its frame-ancestors.
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'",
};

/** The files of the film in `dir` that may be served, or null if its talkie.json is not usable. */
async function servable(dir: string): Promise<Set<string> | null> {
  let parsed: unknown;
  try {
    parsed = await readJson<unknown>(join(dir, FILM_JSON));
  } catch {
    return null;
  }
  const result = validateFilm(parsed);
  return result.ok ? new Set(listedPaths(result.film)) : null;
}

/**
 * GET /api/r/<token>/film/<version>/<path...>: one file of a Talkie version's film, with HTTP
 * Range support. The version is a path segment because the player resolves every file relative
 * to the folder URL, which drops a query string. The token and version checks are the video
 * route's. The only paths served are talkie.json and the files it lists, so nothing else in the
 * version directory can be reached, however the path is spelled.
 *
 * `segments` arrive already decoded, so an encoded ".." or "/" shows up here as itself. The path
 * must then be, character for character, one the film lists.
 */
export function getFilmFile(
  req: Request,
  token: string,
  version: string,
  segments: string[] | undefined
): Promise<Response> {
  return guarded(async () => {
    const media = await resolveMediaVersion(req, token, version);
    if (media === null || media.kind !== 'talkie') return notFound();

    const path = Array.isArray(segments) ? segments.join('/') : '';
    if (!isSafeRelativePath(path)) return notFound();
    const dir = filmDir(media.video.videoId, media.version);
    const allowed = await servable(dir);
    if (allowed === null || !allowed.has(path)) return notFound();

    // Scenes are stored gzipped (see film-files.ts); films imported before that have them plain.
    const stored = await locateFilmFile(dir, path);
    if (stored === null) return notFound();
    const headers = { 'Content-Type': mimeFor(path), ...LOCKED_DOWN };
    return stored.gzipped
      ? serveGzippedFile(stored.file, headers)
      : serveFile(req, stored.file, headers);
  });
}
