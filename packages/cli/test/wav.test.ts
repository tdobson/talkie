import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLow } from '../src/audio/lowproc';
import { normaliseLine, readWav, writeWav } from '../src/audio/wav';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
// without ffmpeg these show as skipped under the title below
const describeFfmpeg = hasFfmpeg ? describe : describe.skip;

test('runLow runs the command at nice 19', async () => {
  const { stdout } = await runLow('sh', ['-c', 'cat /proc/self/stat']);
  const text = stdout.toString();
  // the text after "(comm) " starts at field 3 (state), so field 19 (nice) is index 16
  expect(text.slice(text.lastIndexOf(')') + 2).split(' ')[16]).toBe('19');
});

test('runLow passes input to stdin and rejects on a non-zero exit', async () => {
  const { stdout } = await runLow('cat', [], { input: new TextEncoder().encode('hello') });
  expect(stdout.toString()).toBe('hello');
  await expect(runLow('sh', ['-c', 'echo bad >&2; exit 3'])).rejects.toThrow('sh exited 3: bad');
});

test('writeWav then readWav round-trips PCM16 mono', () => {
  const samples = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
  const bytes = writeWav(samples, 48000);
  expect(bytes.length).toBe(44 + samples.length * 2);
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
  const back = readWav(bytes);
  expect(back.sampleRate).toBe(48000);
  expect(Array.from(back.samples)).toEqual(Array.from(samples));
});

test('readWav skips chunks it does not know and honours odd chunk padding', () => {
  const plain = writeWav(Int16Array.from([5, -6, 7]), 24000);
  const list = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 3, 0, 0, 0, 1, 2, 3, 0]); // "LIST", 3 bytes, pad
  const bytes = new Uint8Array(plain.length + list.length);
  bytes.set(plain.subarray(0, 36));
  bytes.set(list, 36);
  bytes.set(plain.subarray(36), 36 + list.length);
  const back = readWav(bytes);
  expect(back.sampleRate).toBe(24000);
  expect(Array.from(back.samples)).toEqual([5, -6, 7]);
});

test('readWav rejects files that are not PCM16 mono WAV', () => {
  expect(() => readWav(new Uint8Array(64))).toThrow('not a WAV file');
  const stereo = writeWav(Int16Array.from([1, 2]), 48000);
  stereo[22] = 2;
  expect(() => readWav(stereo)).toThrow('expected PCM16 mono, got format 1, 2 channels, 16 bits');
});

describeFfmpeg('needs ffmpeg (skipped when ffmpeg is not on the path)', () => {
  test('normaliseLine resamples to 48 kHz mono PCM16 and caches next to the source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'talkie-wav-'));
    try {
      const src = join(dir, 'line.wav');
      const tone = Int16Array.from({ length: 24000 }, (_, i) =>
        Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 24000))
      );
      await writeFile(src, writeWav(tone, 24000));
      const first = await normaliseLine(src);
      expect(first.file).toBe(join(dir, 'line.48k.wav'));
      expect(first.sampleRate).toBe(48000);
      expect(Math.abs(first.samples.length - 48000)).toBeLessThanOrEqual(64);
      const made = (await stat(first.file)).mtimeMs;
      const second = await normaliseLine(src);
      expect((await stat(second.file)).mtimeMs).toBe(made);
      expect(second.samples.length).toBe(first.samples.length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});
