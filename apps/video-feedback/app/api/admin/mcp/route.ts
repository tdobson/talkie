import { checkAdmin, checkSameOrigin } from '@/lib/auth/guard';
import { mcpServer } from '@/lib/mcp';
import { mcpMethodNotAllowed, mcpPost } from '@/lib/mcp/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A call to wait_for_feedback holds its response open while it waits.
export const maxDuration = 1800;

/**
 * POST /api/admin/mcp: the MCP server for agents (Streamable HTTP, stateless). Behind
 * Cloudflare Access like the rest of the admin API: a service token gets an agent in.
 * See docs/review-platform-for-agents.md.
 */
export async function POST(req: Request): Promise<Response> {
  const check = await checkAdmin(req);
  if (!check.ok) return check.response;
  const forged = checkSameOrigin(req);
  if (forged) return forged;
  return mcpPost(req, mcpServer, check.identity);
}

export async function GET(req: Request): Promise<Response> {
  const check = await checkAdmin(req);
  if (!check.ok) return check.response;
  return mcpMethodNotAllowed();
}

export const DELETE = GET;
