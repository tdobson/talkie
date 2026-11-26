import { handleFinish } from '@/lib/mcp/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Joining the parts and importing a large film takes minutes. The answer is sent after at most
// a minute either way (see uploadLimits.finishWaitMs); the import carries on after it.
export const maxDuration = 1800;

type Ctx = { params: Promise<{ token: string }> };

/**
 * POST /api/upload/<uploadId>.<secret>/finish?bytes=N: the parts are all sent. Checks they add
 * up to N bytes, puts the film in the inbox and imports it. Answers JSON with the review link.
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { token } = await params;
  return handleFinish(token, new URL(req.url).searchParams.get('bytes'));
}
