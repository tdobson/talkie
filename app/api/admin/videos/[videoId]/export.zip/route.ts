import { withAdmin } from '@/lib/auth/guard';
import { exportResponse } from '@/lib/export/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/videos/<videoId>/export.zip?version=latest|<n>|all&clips=1&since=<ISO>&partial=1
 * Streams the export bundle. 202 while comments are processing, 304 when the ETag matches.
 */
export const GET = withAdmin(async (req: Request, ctx: { params: Promise<{ videoId: string }> }) =>
  exportResponse(req, (await ctx.params).videoId, 'zip')
);
