import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lineHash, readVoice, writeVoice } from '../src/voice-cache';

const line = { provider: 'fake', voice: 'onyx', prompt: 'calm', spokenText: 'Fix every tile.' };

test('lineHash is the SHA-256 of the JSON of the four fields, whatever the key order', () => {
  // sha256 of {"provider":"fake","voice":"onyx","prompt":"calm","spokenText":"Fix every tile."}
  expect(lineHash(line)).toBe('417058bd7cd9f5f283db00e2bafb994085db2d5bfbc83648619986d56b77730f');
  expect(
    lineHash({ spokenText: line.spokenText, prompt: 'calm', voice: 'onyx', provider: 'fake' })
  ).toBe(lineHash(line));
  expect(lineHash({ ...line, spokenText: 'Fix every tile' })).not.toBe(lineHash(line));
  expect(lineHash({ ...line, extra: 1 } as typeof line)).toBe(lineHash(line));
});

describe('in a project folder', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'talkie-voice-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('readVoice is null when nothing is cached', async () => {
    expect(await readVoice(dir, 's01-a', lineHash(line))).toBeNull();
  });

  test('writeVoice stores the WAV by hash and readVoice finds it', async () => {
    const hash = lineHash(line);
    const wav = Uint8Array.from([1, 2, 3, 4]);
    const written = await writeVoice(dir, 's01-a', {
      hash,
      wav,
      seconds: 1.25,
      text: line.spokenText,
    });
    expect(written).toEqual({ file: join(dir, '.talkie', 'voice', `${hash}.wav`), seconds: 1.25 });
    expect(Array.from(await readFile(written.file))).toEqual([1, 2, 3, 4]);
    expect(await readVoice(dir, 's01-a', hash)).toEqual(written);
    expect(JSON.parse(await readFile(join(dir, '.talkie', 'voice', 'index.json'), 'utf8'))).toEqual(
      {
        's01-a': { hash, file: `${hash}.wav`, seconds: 1.25, text: 'Fix every tile.' },
      }
    );
  });

  test('a changed line is stale, and a missing WAV is a miss', async () => {
    const hash = lineHash(line);
    const written = await writeVoice(dir, 's01-a', {
      hash,
      wav: Uint8Array.from([1]),
      seconds: 1,
      text: 'x',
    });
    expect(await readVoice(dir, 's01-a', lineHash({ ...line, voice: 'ash' }))).toBeNull();
    expect(await readVoice(dir, 's01-b', hash)).toBeNull();
    await rm(written.file);
    expect(await readVoice(dir, 's01-a', hash)).toBeNull();
  });

  test('the index keeps other lines and is written with sorted keys', async () => {
    await writeVoice(dir, 'b', { hash: 'h2', wav: Uint8Array.from([2]), seconds: 2, text: 'two' });
    await writeVoice(dir, 'a', { hash: 'h1', wav: Uint8Array.from([1]), seconds: 1, text: 'one' });
    const raw = await readFile(join(dir, '.talkie', 'voice', 'index.json'), 'utf8');
    expect(Object.keys(JSON.parse(raw))).toEqual(['a', 'b']);
    expect(raw.endsWith('}\n')).toBe(true);
    expect(await readVoice(dir, 'b', 'h2')).toEqual({
      file: join(dir, '.talkie', 'voice', 'h2.wav'),
      seconds: 2,
    });
  });
});
