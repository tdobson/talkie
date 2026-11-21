import { clientIp, guarded, json, notFound, readJsonBody } from '@/lib/review/http';
import { startSession } from '@/lib/review/service';
import type { CreateSessionBody } from '@/lib/types';

type Ctx = { params: Promise<{ token: string }> };

/** POST /api/r/<token>/sessions: start a review session on the latest version. */
export function POST(req: Request, { params }: Ctx): Promise<Response> {
  return guarded(async () => {
    const { token } = await params;
    const body = (await readJsonBody(req)) as CreateSessionBody;
    const result = await startSession(token, body, { ip: clientIp(req) });
    return result === null ? notFound() : json(result);
  });
}
