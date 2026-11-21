import { join } from 'node:path';
import { isSafeRelativePath, mimeFor, validateFilm } from '@talkie/format';
import { guarded, notFound } from '@/lib/review/http';
import { resolveMediaVersion, serveFile } from '@/lib/review/media-route';
import { readJson } from '@/lib/storage/json';
import { filmDir } from '@/lib/storage/paths';
import { FILM_JSON, listedPaths } from '@/lib/videos/film';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ token: string; version: string; path?: string[] }> };

/**
 * A film file is only ever data for the player. If one is opened as a page of its own (an SVG
 * poster can carry script), it runs with nothing and reaches nothing.
 */
const LOCKED_DOWN = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
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
 * to the folder URL, which drops a query string. The token and version checks are the video route's. The only paths served are
 * talkie.json and the files it lists, so nothing else in the version directory can be reached,
 * however the path is spelled.
 */
export function GET(req: Request, { params }: Ctx): Promise<Response> {
  return guarded(async () => {
    const { token, version, path: segments } = await params;
    const media = await resolveMediaVersion(req, token, version);
    if (media === null || media.kind !== 'talkie') return notFound();

    // Next hands the segments over already decoded, so an encoded ".." or "/" shows up here as
    // itself. The path must then be, character for character, one the film lists.
    const path = Array.isArray(segments) ? segments.join('/') : '';
    if (!isSafeRelativePath(path)) return notFound();
    const dir = filmDir(media.video.videoId, media.version);
    const allowed = await servable(dir);
    if (allowed === null || !allowed.has(path)) return notFound();

    return serveFile(req, join(dir, ...path.split('/')), {
      'Content-Type': mimeFor(path),
      ...LOCKED_DOWN,
    });
  });
}
