import { MAX_CHUNK_BYTES } from '@/lib/constants';
import { guarded, json } from '@/lib/review/http';
import { ReviewInputError, receiveChunk } from '@/lib/review/service';
import type { CaptureEvent, CommentMeta } from '@/lib/types';

type Ctx = { params: Promise<{ token: string; sid: string; cid: string; seq: string }> };

/** Room for the events and meta fields and the multipart framing around the audio. */
const MAX_BODY_BYTES = MAX_CHUNK_BYTES + 4 * 1024 * 1024;

/** A JSON form field, or undefined when it is absent or not parseable. */
function jsonField(form: FormData, name: string): unknown {
  const value = form.get(name);
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * PUT .../comments/<cid>/chunks/<seq>: multipart with `audio` (blob), `events` (JSON array)
 * and, on chunk 0, `meta` (JSON). The service validates all three.
 */
export function PUT(req: Request, { params }: Ctx): Promise<Response> {
  return guarded(async () => {
    const { token, sid, cid, seq } = await params;

    // Refuse an obviously oversized upload before reading it into memory.
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) return json({ error: 'chunk too large' }, 413);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ReviewInputError('Body must be multipart form data.');
    }
    const result = await receiveChunk(token, sid, cid, /^\d{1,9}$/.test(seq) ? Number(seq) : -1, {
      audio: form.get('audio') as Blob,
      events: jsonField(form, 'events') as CaptureEvent[],
      meta: jsonField(form, 'meta') as CommentMeta | undefined,
    });
    return json(result.body, result.status);
  });
}
