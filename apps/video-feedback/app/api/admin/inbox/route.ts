import { afterImport } from '@/lib/admin/after-import';
import { withAdmin } from '@/lib/auth/guard';
import type { ImportRequest, ImportResult } from '@/lib/types';
import { importFromInbox, listInbox } from '@/lib/videos/import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

export const GET = withAdmin<unknown>(async () =>
  Response.json(await listInbox(), { headers: noStore })
);

export const POST = withAdmin<unknown>(async (req) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const result: ImportResult = { ok: false, reason: 'The request body must be JSON.' };
    return Response.json(result, { status: 400, headers: noStore });
  }
  // importFromInbox validates the shape itself.
  const result = await importFromInbox(body as ImportRequest);
  if (!result.ok) return Response.json(result, { status: 400, headers: noStore });
  // The review link and a pointer to watching for feedback, so the agent that put the film up
  // is prompted to listen for the replies.
  const extra = await afterImport(result.videoId);
  return Response.json({ ...result, ...extra }, { headers: noStore });
});
