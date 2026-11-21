import { guarded, json, notFound } from '@/lib/review/http';
import { readSession } from '@/lib/review/service';

type Ctx = { params: Promise<{ token: string; sid: string }> };

/** GET /api/r/<token>/sessions/<sid>: lets a returning reviewer resume their session. */
export function GET(_req: Request, { params }: Ctx): Promise<Response> {
  return guarded(async () => {
    const { token, sid } = await params;
    const result = await readSession(token, sid);
    return result === null ? notFound() : json(result);
  });
}
