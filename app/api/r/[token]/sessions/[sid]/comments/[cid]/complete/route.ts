import { guarded, json, readJsonBody } from '@/lib/review/http';
import { completeComment } from '@/lib/review/service';
import type { CompleteBody } from '@/lib/types';

type Ctx = { params: Promise<{ token: string; sid: string; cid: string }> };

/** POST .../comments/<cid>/complete: 200 once every chunk is stored, 409 with the gaps if not. */
export function POST(req: Request, { params }: Ctx): Promise<Response> {
  return guarded(async () => {
    const { token, sid, cid } = await params;
    const body = (await readJsonBody(req)) as CompleteBody;
    const result = await completeComment(token, sid, cid, body);
    return json(result.body, result.status);
  });
}
