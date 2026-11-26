import { handlePart, handlePartSize } from '@/lib/mcp/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A 64 MiB part on a slow connection takes a while.
export const maxDuration = 1800;

type Ctx = { params: Promise<{ token: string; n: string }> };

/**
 * PUT /api/upload/<uploadId>.<secret>/part/<n>: one part of a film an agent is sending, as the
 * raw body. Not under /api/admin: the secret in the link is the credential (upload_film makes
 * it). See lib/mcp/uploads.ts.
 */
export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  const { token, n } = await params;
  return handlePart(token, n, req);
}

/**
 * GET: the size of part n as stored (plain text), or 404. The command asks before sending a
 * part, so running it again resumes instead of sending the whole film again.
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { token, n } = await params;
  return handlePartSize(token, n);
}

/** HEAD: as GET, without the body, for a client that only wants the status. */
export async function HEAD(_req: Request, { params }: Ctx): Promise<Response> {
  const { token, n } = await params;
  const res = await handlePartSize(token, n);
  return new Response(null, { status: res.status, headers: res.headers });
}
