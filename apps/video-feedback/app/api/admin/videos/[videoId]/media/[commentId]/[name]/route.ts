import { commentMediaResponse } from '@/lib/admin/comment-media';
import { withAdmin } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/videos/<videoId>/media/<commentId>/<name>
 * One still, clip or recording of a comment: the `media/...` paths in export.json, resolved
 * against /api/admin/videos/<videoId>/. Available as soon as the comment is processed.
 */
export const GET = withAdmin(
  async (
    req: Request,
    ctx: { params: Promise<{ videoId: string; commentId: string; name: string }> }
  ) => {
    const { videoId, commentId, name } = await ctx.params;
    return commentMediaResponse(req, videoId, commentId, name);
  }
);
