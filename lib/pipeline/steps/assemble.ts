import { existsSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { concatChunks, toWav16k } from '@/lib/media/ops';
import { readJson, writeJsonAtomic } from '@/lib/storage/json';
import type { CaptureEvent } from '@/lib/types';
import { audioFileName, FILES, NoAudioError, type StepFn } from './types';

const CHUNK_FILE_RE = /^(\d+)\.bin$/;

/** Stored chunk sequence numbers, ascending. */
async function storedSeqs(dir: string): Promise<number[]> {
  let names: string[];
  try {
    names = await readdir(join(dir, 'chunks'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return names
    .map((name) => CHUNK_FILE_RE.exec(name))
    .filter((m) => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

/**
 * The `audio` step: joins the upload chunks in sequence order into the recording, merges the
 * per-chunk event batches into `events.json` sorted by time, and makes the 16 kHz mono WAV
 * that silence detection and transcription read.
 *
 * A comment made with no microphone arrives as events with zero bytes of audio. Its events
 * are still merged, then `NoAudioError` tells the processor to skip the steps that need sound.
 */
export const assembleStep: StepFn = async ({ dir, meta, log }) => {
  const stored = await storedSeqs(dir);
  const total = meta.totalChunks ?? (stored.length > 0 ? (stored.at(-1) as number) + 1 : 0);
  if (total === 0) throw new Error('The comment has no audio chunks.');
  const have = new Set(stored);
  const seqs = [...Array(total).keys()];
  for (const seq of seqs) {
    if (!have.has(seq)) throw new Error(`Audio chunk ${seq} is missing (expected ${total}).`);
  }

  const audio = join(dir, audioFileName(meta.audioMime));
  await concatChunks(
    seqs.map((seq) => join(dir, 'chunks', `${seq}.bin`)),
    audio
  );

  const events: CaptureEvent[] = [];
  for (const seq of seqs) {
    const file = join(dir, 'events', `${seq}.json`);
    if (!existsSync(file)) continue;
    const batch = await readJson<CaptureEvent[]>(file);
    if (Array.isArray(batch)) {
      events.push(...batch.filter((e) => e !== null && typeof e?.t === 'number'));
    }
  }
  // Array.prototype.sort is stable, so events with the same `t` keep their recorded order.
  events.sort((a, b) => a.t - b.t);
  await writeJsonAtomic(join(dir, FILES.events), events);

  if ((await stat(audio)).size === 0) {
    await rm(join(dir, FILES.wav), { force: true });
    log(`no audio in ${total} chunks, kept ${events.length} events`);
    throw new NoAudioError();
  }
  await toWav16k(audio, join(dir, FILES.wav));
  log(`assembled ${total} chunks and ${events.length} events`);
};
