import { MAX_CHUNK_BYTES, MAX_EVENTS_BYTES } from '@/lib/constants';
import { guarded, json, readBodyCapped } from '@/lib/review/http';
import { admitChunk, ReviewInputError } from '@/lib/review/service';
import type { CaptureEvent, CommentMeta } from '@/lib/types';

type Ctx = { params: Promise<{ token: string; sid: string; cid: string; seq: string }> };

/** Room for the audio, the events, the meta field and the multipart framing around them. */
const MAX_BODY_BYTES = MAX_CHUNK_BYTES + MAX_EVENTS_BYTES + 1024 * 1024;

const TOO_LARGE = { error: 'chunk too large' };

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

/** Parses multipart bytes that are already in memory, and so already bounded. */
async function parseForm(bytes: Uint8Array, contentType: string | null): Promise<FormData> {
  try {
    const headers = contentType === null ? undefined : { 'Content-Type': contentType };
    return await new Response(bytes as BodyInit, { headers }).formData();
  } catch {
    throw new ReviewInputError('Body must be multipart form data.');
  }
}

/**
 * PUT .../comments/<cid>/chunks/<seq>: multipart with `audio` (blob), `events` (JSON array)
 * and, on chunk 0, `meta` (JSON). The service validates all three.
 *
 * Nothing of the body is read until the token, session and rate limit have been checked, and
 * then no more than `MAX_BODY_BYTES` of it, whatever the request says about its length.
 */
export function PUT(req: Request, { params }: Ctx): Promise<Response> {
  return guarded(async () => {
    const { token, sid, cid, seq } = await params;
    const admission = await admitChunk(token, sid, cid, /^\d{1,9}$/.test(seq) ? Number(seq) : -1);
    if (!admission.ok) return json(admission.reply.body, admission.reply.status);

    const bytes = await readBodyCapped(req, MAX_BODY_BYTES);
    if (bytes === null) return json(TOO_LARGE, 413);
    const form = await parseForm(bytes, req.headers.get('content-type'));

    // Refused before it is parsed, so the size of the JSON tree is bounded too.
    const rawEvents = form.get('events');
    if (typeof rawEvents === 'string' && Buffer.byteLength(rawEvents) > MAX_EVENTS_BYTES) {
      return json(TOO_LARGE, 413);
    }
    const result = await admission.store({
      audio: form.get('audio') as Blob,
      events: jsonField(form, 'events') as CaptureEvent[],
      meta: jsonField(form, 'meta') as CommentMeta | undefined,
    });
    return json(result.body, result.status);
  });
}
