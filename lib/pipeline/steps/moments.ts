import { join } from 'node:path';
import { audioDuration } from '@/lib/media/ops';
import { selectMoments } from '@/lib/moments';
import { readJson, writeJsonAtomic } from '@/lib/storage/json';
import type { CaptureEvent, Transcript } from '@/lib/types';
import { FILES, type StepFn } from './types';

/**
 * The `moments` step: picks the key moments from the event log and, when there is one, the
 * transcript. It still runs after a failed transcription, just without word moments.
 */
export const momentsStep: StepFn = async ({ dir, meta, log }) => {
  const events = (await readJson<CaptureEvent[]>(join(dir, FILES.events))) ?? [];
  let transcript: Transcript | null = null;
  try {
    transcript = await readJson<Transcript>(join(dir, FILES.transcript));
  } catch {
    log('transcript.json is unreadable, choosing moments without it');
  }
  const durationMs =
    meta.durationMs ?? Math.round((await audioDuration(join(dir, FILES.wav))) * 1000);
  const moments = selectMoments({
    kind: meta.kind,
    pausedAtVideoTime: meta.pausedAtVideoTime,
    durationMs,
    events,
    transcript,
  });
  await writeJsonAtomic(join(dir, FILES.moments), moments);
  log(`chose ${moments.length} moments`);
};
