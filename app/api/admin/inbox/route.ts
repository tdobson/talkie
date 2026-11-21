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
  return Response.json(result, { status: result.ok ? 200 : 400, headers: noStore });
});
