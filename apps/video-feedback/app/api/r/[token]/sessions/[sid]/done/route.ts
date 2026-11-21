import { guarded, json, notFound } from '@/lib/review/http';
import { finishSession } from '@/lib/review/service';

type Ctx = { params: Promise<{ token: string; sid: string }> };

/** POST /api/r/<token>/sessions/<sid>/done: the reviewer has finished. */
export function POST(_req: Request, { params }: Ctx): Promise<Response> {
  return guarded(async () => {
    const { token, sid } = await params;
    return (await finishSession(token, sid)) ? json({ ok: true }) : notFound();
  });
}
