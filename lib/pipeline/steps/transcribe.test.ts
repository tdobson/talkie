import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fx } from '@/lib/media/testutil';
import { fakeTranscriber, groqTranscriber } from './transcribe';

const wav = fx('speech-like.wav');
const fixture = fileURLToPath(
  new URL('../../../test/fixtures/transcript-basic.json', import.meta.url)
);

/** Lets real file IO finish, then moves the fake clock on, until `done` or we give up. */
async function drive(done: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !done(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(10_000);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

it('retries Groq on 429 then fails cleanly', async () => {
  // Only the timers are faked: the wav is read with real file IO before the first request.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const fetchImpl = vi.fn().mockResolvedValue(new Response('slow down', { status: 429 }));
  let settled = false;
  const p = groqTranscriber('k', 'https://api.groq.test', fetchImpl)
    .transcribe(wav, 'en')
    .finally(() => {
      settled = true;
    });
  const assertion = expect(p).rejects.toThrow(/429/);
  await drive(() => settled);
  await assertion;
  expect(fetchImpl).toHaveBeenCalledTimes(4);
});

it('retries 5xx and network errors, then succeeds', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const body = await readFile(fixture, 'utf8');
  const fetchImpl = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
    .mockResolvedValueOnce(new Response(body, { status: 200 }));
  let settled = false;
  const p = groqTranscriber('k', 'https://api.groq.test', fetchImpl)
    .transcribe(wav, 'en')
    .finally(() => {
      settled = true;
    });
  await drive(() => settled);
  expect((await p).words).toHaveLength(15);
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});

it('does not retry a 4xx other than 429', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { error: { message: 'Invalid API Key', type: 'invalid_request_error' } },
        { status: 401 }
      )
    );
  await expect(
    groqTranscriber('k', 'https://api.groq.test', fetchImpl).transcribe(wav, 'en')
  ).rejects.toThrow(/401.*Invalid API Key/);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('maps Groq verbose_json to Transcript', async () => {
  const body = await readFile(fixture, 'utf8');
  const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
  const t = await groqTranscriber(
    'secret',
    'https://api.groq.test/openai/v1/',
    fetchImpl
  ).transcribe(wav, 'en');

  expect(t.text).toBe('so this logo is the old one and the text here runs on too long');
  expect(t.language).toBe('English');
  expect(t.duration).toBe(9.6);
  expect(t.words).toHaveLength(15);
  expect(t.words[1]).toEqual({ word: 'this', start: 3.2, end: 3.46 });
  expect(t.segments).toEqual([
    { start: 2.9, end: 4.98, text: 'so this logo is the old one' },
    { start: 6.6, end: 9.42, text: 'and the text here runs on too long' },
  ]);

  const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://api.groq.test/openai/v1/audio/transcriptions');
  expect(init.method).toBe('POST');
  expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret');
  const form = init.body as FormData;
  expect(form.get('model')).toBe('whisper-large-v3');
  expect(form.get('response_format')).toBe('verbose_json');
  expect(form.getAll('timestamp_granularities[]')).toEqual(['word', 'segment']);
  expect(form.get('language')).toBe('en');
  const file = form.get('file') as File;
  expect(file.name).toBe('audio.wav');
  expect(file.size).toBeGreaterThan(1000);
});

it('tolerates a response with no words or segments', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(Response.json({ text: ' hello ' }));
  expect(
    await groqTranscriber('k', 'https://api.groq.test', fetchImpl).transcribe(wav, 'en')
  ).toEqual({ text: 'hello', language: null, duration: null, words: [], segments: [] });
});

it('rejects a 200 that is not a transcript', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>', { status: 200 }));
  await expect(
    groqTranscriber('k', 'https://api.groq.test', fetchImpl).transcribe(wav, 'en')
  ).rejects.toThrow(/unexpected response/i);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('fakeTranscriber spreads the fixed sentence across the audio', async () => {
  const t = await fakeTranscriber.transcribe(wav, 'en');
  expect(t.text).toBe('so this logo is the old one and the text here runs on too long');
  expect(t.words.map((w) => w.word).join(' ')).toBe(t.text);
  expect(t.duration).toBeCloseTo(3, 1);
  expect(t.words[0].start).toBeGreaterThanOrEqual(0);
  expect(t.words.at(-1)?.end).toBeLessThanOrEqual(3.01);
  for (let i = 1; i < t.words.length; i++) {
    expect(t.words[i].start).toBeGreaterThanOrEqual(t.words[i - 1].end);
  }
  expect(await fakeTranscriber.transcribe(wav, 'en')).toEqual(t);
});
