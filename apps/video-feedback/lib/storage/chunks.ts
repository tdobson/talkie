import { randomBytes } from 'node:crypto';
import { link, mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptureEvent } from '@/lib/types';

const CHUNK_FILE_RE = /^(\d+)\.bin$/;

function code(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

function assertSeq(seq: number): void {
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
    throw new Error('Invalid chunk sequence number.');
  }
}

/**
 * Creates `path` with `data` only if nothing is there yet. Returns false if it already existed.
 *
 * The bytes go to a private tmp file (opened with exclusive create) which is then hard-linked
 * to the final name. `link` fails with EEXIST when the name is taken, so of several concurrent
 * writers exactly one wins, and the final name only ever appears with its complete content.
 */
async function createExclusive(path: string, data: Buffer | string): Promise<boolean> {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await open(tmp, 'wx');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(tmp, path);
      return true;
    } catch (err) {
      if (code(err) === 'EEXIST') return false;
      throw err;
    }
  } finally {
    await rm(tmp, { force: true });
  }
}

/**
 * Stores one upload chunk under a comment directory: audio in `chunks/<seq>.bin`, its event
 * batch in `events/<seq>.json`. The first write for a `seq` wins; later ones change nothing
 * and report 'duplicate', so the client can retry freely.
 *
 * Events are written first. A chunk counts as stored only once its `.bin` exists, so a crash
 * between the two writes leaves the chunk "missing" and the retry completes it.
 */
export async function putChunk(
  dir: string,
  seq: number,
  audio: Buffer,
  events: CaptureEvent[]
): Promise<'stored' | 'duplicate'> {
  assertSeq(seq);
  const chunksDir = join(dir, 'chunks');
  const eventsDir = join(dir, 'events');
  await Promise.all([mkdir(chunksDir, { recursive: true }), mkdir(eventsDir, { recursive: true })]);
  await createExclusive(join(eventsDir, `${seq}.json`), JSON.stringify(events));
  const stored = await createExclusive(join(chunksDir, `${seq}.bin`), audio);
  return stored ? 'stored' : 'duplicate';
}

async function storedSeqs(dir: string): Promise<number[]> {
  let names: string[];
  try {
    names = await readdir(join(dir, 'chunks'));
  } catch (err) {
    if (code(err) === 'ENOENT') return [];
    throw err;
  }
  const seqs: number[] = [];
  for (const name of names) {
    const m = CHUNK_FILE_RE.exec(name);
    if (m) seqs.push(Number(m[1]));
  }
  return seqs;
}

/** The sequence numbers in `0..total-1` that have no stored audio chunk, ascending. */
export async function missingChunks(dir: string, total: number): Promise<number[]> {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid chunk total.');
  const have = new Set(await storedSeqs(dir));
  const missing: number[] = [];
  for (let seq = 0; seq < total; seq++) {
    if (!have.has(seq)) missing.push(seq);
  }
  return missing;
}

/** Total size in bytes of the audio chunks stored so far. */
export async function storedBytes(dir: string): Promise<number> {
  const seqs = await storedSeqs(dir);
  const sizes = await Promise.all(
    seqs.map(async (seq) => (await stat(join(dir, 'chunks', `${seq}.bin`))).size)
  );
  return sizes.reduce((sum, n) => sum + n, 0);
}
