import { withAdmin } from '@/lib/auth/guard';
import { isWorkingOn, readPipelineStatus } from '@/lib/pipeline/pipeline-status';
import { prepareReprocess, type ReprocessOptions } from '@/lib/pipeline/reprocess';
import { isStepName } from '@/lib/pipeline/steps/types';
import { kickWorker } from '@/lib/pipeline/worker-host';
import { isUuid } from '@/lib/storage/ids';
import { ID_RE } from '@/lib/storage/paths';
import { getVideo } from '@/lib/storage/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) =>
  Response.json({ error }, { status, headers: noStore });

/** Reads `{ version?, commentId?, fromStep? }`. An empty body means "retry what failed". */
async function parseBody(req: Request): Promise<ReprocessOptions | null> {
  const text = await req.text();
  if (text.trim() === '') return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const { version, commentId, fromStep } = body as Record<string, unknown>;
  const opts: ReprocessOptions = {};
  if (version !== undefined) {
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
    opts.version = version;
  }
  if (commentId !== undefined) {
    if (typeof commentId !== 'string' || !isUuid(commentId)) return null;
    opts.commentId = commentId;
  }
  if (fromStep !== undefined) {
    if (!isStepName(fromStep)) return null;
    opts.fromStep = fromStep;
  }
  return opts;
}

/**
 * POST /api/admin/videos/<videoId>/reprocess
 * Clears derived outputs and puts the matching comments back on the processing queue.
 */
export const POST = withAdmin(
  async (req: Request, ctx: { params: Promise<{ videoId: string }> }) => {
    const { videoId } = await ctx.params;
    if (!ID_RE.test(videoId) || (await getVideo(videoId)) === null) return fail(404, 'not found');
    const opts = await parseBody(req);
    if (opts === null) return fail(400, 'invalid request');

    // A comment the worker is working on right now is left alone: its files are in use. That
    // includes the clip pass, which would otherwise write `done` over the re-queued status.
    const working = await readPipelineStatus();
    const jobs = await prepareReprocess(videoId, opts, (ref) =>
      isWorkingOn(working, ref.commentId)
    );
    // They are `queued` on disk now; the worker picks them up, at once when told.
    kickWorker();
    return Response.json(
      { ok: true, queued: jobs.length, commentIds: jobs.map((job) => job.ref.commentId) },
      { headers: noStore }
    );
  }
);
