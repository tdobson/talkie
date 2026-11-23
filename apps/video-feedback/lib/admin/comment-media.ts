import { join } from 'node:path';
import { FILES } from '@/lib/pipeline/steps/types';
import { serveFile } from '@/lib/review/media-route';
import { isUuid } from '@/lib/storage/ids';
import { commentDir, ID_RE } from '@/lib/storage/paths';
import { listComments, listSessions } from '@/lib/storage/repo';

// One file of one comment, at the path export.json gives it (`media/<commentId>/<name>`), so a
// watcher can fetch a comment's stills as soon as the comment is processed, without the zip.

const TYPES: [RegExp, string, 'render' | 'comment'][] = [
  [/^(overview|moment-\d{2,}(-zoom)?)\.jpg$/, 'image/jpeg', 'render'],
  [/^clip\.mp4$/, 'video/mp4', 'render'],
  [/^audio\.mp4$/, 'audio/mp4', 'comment'],
  [/^audio\.webm$/, 'audio/webm', 'comment'],
];

const notFound = () =>
  Response.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/** GET /api/admin/videos/<videoId>/media/<commentId>/<name> */
export async function commentMediaResponse(
  req: Request,
  videoId: string,
  commentId: string,
  name: string
): Promise<Response> {
  const type = TYPES.find(([re]) => re.test(name));
  if (type === undefined || !ID_RE.test(videoId) || !isUuid(commentId)) return notFound();

  for (const session of await listSessions(videoId)) {
    const ref = (await listComments(videoId, session.sessionId)).find(
      (r) => r.commentId === commentId
    );
    if (ref === undefined) continue;
    const dir = commentDir(ref);
    const path = type[2] === 'render' ? join(dir, FILES.renderDir, name) : join(dir, name);
    // A reprocess writes the stills again under the same names, so always ask.
    return serveFile(req, path, {
      'Content-Type': type[1],
      'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
  }
  return notFound();
}
