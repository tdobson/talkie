import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One cached line in `.talkie/voice/index.json`. */
export interface VoiceEntry {
  hash: string;
  /** File name inside `.talkie/voice/`. */
  file: string;
  seconds: number;
  text: string;
}
export type VoiceIndex = Record<string, VoiceEntry>;

export interface LineIdentity {
  provider: string;
  voice: string;
  prompt: string;
  spokenText: string;
}

const voiceDir = (projectDir: string) => join(projectDir, '.talkie', 'voice');

/** SHA-256 of the JSON of everything that changes how a line sounds. A different hash means a stale voice. */
export function lineHash({ provider, voice, prompt, spokenText }: LineIdentity): string {
  return createHash('sha256')
    .update(JSON.stringify({ provider, voice, prompt, spokenText }))
    .digest('hex');
}

async function readIndex(projectDir: string): Promise<VoiceIndex> {
  try {
    return JSON.parse(await readFile(join(voiceDir(projectDir), 'index.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

/** The cached voice for a line, or `null` when there is none, it is stale, or its WAV has gone. */
export async function readVoice(
  projectDir: string,
  lineId: string,
  expectedHash: string
): Promise<{ file: string; seconds: number } | null> {
  const index = await readIndex(projectDir);
  const entry = Object.hasOwn(index, lineId) ? index[lineId] : undefined;
  if (!entry || entry.hash !== expectedHash) {
    return null;
  }
  const file = join(voiceDir(projectDir), entry.file);
  try {
    await access(file);
  } catch {
    return null;
  }
  return { file, seconds: entry.seconds };
}

/** Store a voiced line as `.talkie/voice/<hash>.wav` and record it in the index (keys sorted). */
export async function writeVoice(
  projectDir: string,
  lineId: string,
  voiced: { hash: string; wav: Uint8Array; seconds: number; text: string }
): Promise<{ file: string; seconds: number }> {
  const dir = voiceDir(projectDir);
  await mkdir(dir, { recursive: true });
  const name = `${voiced.hash}.wav`;
  await writeFile(join(dir, name), voiced.wav);
  const index = await readIndex(projectDir);
  index[lineId] = { hash: voiced.hash, file: name, seconds: voiced.seconds, text: voiced.text };
  const sorted = Object.fromEntries(Object.entries(index).toSorted(([a], [b]) => (a < b ? -1 : 1)));
  // write then rename, so a crash never leaves half an index
  const part = join(dir, 'index.json.part');
  await writeFile(part, `${JSON.stringify(sorted, null, 2)}\n`);
  await rename(part, join(dir, 'index.json'));
  return { file: join(dir, name), seconds: voiced.seconds };
}
