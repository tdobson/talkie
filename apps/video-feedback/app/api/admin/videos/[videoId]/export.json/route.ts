import { withAdmin } from '@/lib/auth/guard';
import { exportResponse } from '@/lib/export/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/videos/<videoId>/export.json
 * The same query as export.zip, answering with feedback.json only.
 */
export const GET = withAdmin(async (req: Request, ctx: { params: Promise<{ videoId: string }> }) =>
  exportResponse(req, (await ctx.params).videoId, 'json')
);
