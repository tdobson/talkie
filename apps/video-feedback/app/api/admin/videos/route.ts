import { summariseVideos } from '@/lib/admin/summary';
import { withAdmin } from '@/lib/auth/guard';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAdmin<unknown>(async () =>
  Response.json(await summariseVideos(config().publicBaseUrl), {
    headers: { 'Cache-Control': 'no-store' },
  })
);
