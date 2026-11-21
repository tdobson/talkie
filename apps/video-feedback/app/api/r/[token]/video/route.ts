import { guarded, notFound } from '@/lib/review/http';
import { resolveMediaVersion, serveFile } from '@/lib/review/media-route';
import { sourcePath } from '@/lib/storage/paths';

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/r/<token>/video?version=<n>: the source video of an MP4 version, with HTTP Range
 * support. A Talkie version has no source video: its film is served by the `film` route.
 */
export function GET(req: Request, { params }: Ctx): Promise<Response> {
  return guarded(async () => {
    const { token } = await params;
    const media = await resolveMediaVersion(req, token);
    if (media === null || media.kind !== 'mp4') return notFound();
    // 'follow', as this route always has: a source.mp4 may be a link to a file kept elsewhere.
    const path = sourcePath(media.video.videoId, media.version);
    return serveFile(req, path, { 'Content-Type': 'video/mp4' }, 'follow');
  });
}
