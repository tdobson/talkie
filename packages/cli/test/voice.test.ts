import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { readWav, writeWav } from '../src/audio/wav';
import { buildFilm } from '../src/build';
import { voiceCommand, voiceFilm, voiceTable } from '../src/commands/voice';
import { fakeProvider, fakeSeconds } from '../src/voice/fake';
import { applyLexicon, flattenLexicon, readLexicon } from '../src/voice/lexicon';
import { openRouterProvider, trimSilence } from '../src/voice/openrouter';
import { providerFor, type VoiceProvider } from '../src/voice/provider';
import { normaliseText, transcribe, wordSimilarity } from '../src/voice/whisper';

jest.setTimeout(180_000);

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
// without ffmpeg these show as skipped
const describeFfmpeg = hasFfmpeg ? describe : describe.skip;

const FIXTURE = resolve(__dirname, 'fixtures/mini-film');
const ALIAS = {
  '@talkie/author': resolve(__dirname, '../../author/src/index.ts'),
  '@talkie/cli': resolve(__dirname, '../src/config.ts'),
};

/** A provider that records what it was asked to say and answers with the fake voice. */
function recorder(): VoiceProvider & { said: string[] } {
  const said: string[] = [];
  return {
    id: 'fake',
    said,
    synthesize(text, o) {
      said.push(text);
      return fakeProvider.synthesize(text, o);
    },
  };
}

const sse = (chunks: string[], status = 200) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }),
    { status }
  );

describe('fake provider', () => {
  test('lasts 0.4 s plus words / 2.45 and is the same every time', async () => {
    const o = { voice: 'test', prompt: 'calm' };
    const a = await fakeProvider.synthesize('One nail holds it down.', o);
    const b = await fakeProvider.synthesize('One nail holds it down.', o);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const wav = readWav(a);
    expect(wav.samples.length / wav.sampleRate).toBeCloseTo(0.4 + 5 / 2.45, 3);
    expect(fakeSeconds('one two')).toBeCloseTo(0.4 + 2 / 2.45, 6);
    const peak = wav.samples.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
    expect(peak).toBeGreaterThan(500);
    expect(peak).toBeLessThan(8000);
  });

  test('providerFor finds a provider by id', () => {
    expect(providerFor('fake').id).toBe('fake');
    expect(providerFor('openrouter').id).toBe('openrouter');
  });
});

describe('lexicon', () => {
  test('flattens the respell form and passes a flat map through', () => {
    expect(flattenLexicon({ comment: 'x', respell: { PV: 'P V' } })).toEqual({ PV: 'P V' });
    expect(flattenLexicon({ PV: 'P V' })).toEqual({ PV: 'P V' });
    expect(() => flattenLexicon({ respell: { PV: 3 } })).toThrow(/respelling/);
  });

  test('respells whole words whatever their case', () => {
    const lexicon = { PV: 'P V', mm: 'millimetres', 'flexible lead': 'flexible led' };
    expect(applyLexicon('A pv array, 345 mm from the Flexible Lead.', lexicon)).toBe(
      'A P V array, 345 millimetres from the flexible led.'
    );
    expect(applyLexicon('The PVC pipe and the hammer.', lexicon)).toBe(
      'The PVC pipe and the hammer.'
    );
  });

  test('reads a lexicon file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'talkie-lexicon-'));
    try {
      const file = join(dir, 'lexicon.json');
      await writeFile(file, JSON.stringify({ respell: { Torx: 'Torks' } }));
      expect(await readLexicon(file)).toEqual({ Torx: 'Torks' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('whisper check', () => {
  test('normalises case, digits and punctuation', () => {
    expect(normaliseText("It's 345 mm, the panel's edge!")).toBe(
      'its three hundred and forty five mm the panels edge'
    );
    expect(normaliseText('Use 2 nails, 1,200 of them: 1.5 each.')).toBe(
      'use two nails one thousand two hundred of them one point five each'
    );
    expect(normaliseText('Zero is 0; 16 and 70 and 101.')).toBe(
      'zero is zero sixteen and seventy and one hundred and one'
    );
  });

  test('word similarity', () => {
    expect(wordSimilarity('One nail holds it down.', 'one nail holds it down')).toBe(1);
    expect(wordSimilarity('This is a roof tile.', 'This is a roof style.')).toBeCloseTo(0.8, 6);
    expect(wordSimilarity('Use 2 nails', 'use two nails')).toBe(1);
    expect(wordSimilarity('hello', '')).toBe(0);
  });

  test('asks Groq for whisper-large-v3', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const heard = await transcribe(writeWav(new Int16Array(100), 24000), {
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ text: ' One nail holds it down. ' }));
      },
      key: 'gsk-test',
    });
    expect(heard).toBe('One nail holds it down.');
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer gsk-test');
    const form = calls[0].init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  test('a clear error without a key', async () => {
    await expect(transcribe(new Uint8Array(), { key: '' })).rejects.toThrow(/GROQ_API_KEY/);
  });
});

describe('openrouter provider', () => {
  const pcm = new Int16Array(24000).map((_, i) => Math.round(3000 * Math.sin(i / 10)));
  const b64 = Buffer.from(pcm.buffer).toString('base64');
  const half = b64.length / 2 - ((b64.length / 2) % 4);
  const event = (data: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { audio: { data } } }] })}\n\n`;
  const body = () => {
    const text = `: comment\n\n${event(b64.slice(0, half))}${event(b64.slice(half))}data: [DONE]\n\n`;
    // split in the middle of a line, as a network would
    return [text.slice(0, 1000), text.slice(1000)];
  };
  const o = { voice: 'ballad', prompt: 'Speak clearly.' };

  test('sends the request and turns the streamed pcm16 into a 24 kHz WAV', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = openRouterProvider({
      key: 'sk-test',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return sse(body());
      },
      trim: async (wav) => wav,
    });
    const wav = readWav(await provider.synthesize('Hello there.', o));
    expect(wav.sampleRate).toBe(24000);
    expect(Array.from(wav.samples)).toEqual(Array.from(pcm));
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      model: 'openai/gpt-audio',
      modalities: ['text', 'audio'],
      audio: { voice: 'ballad', format: 'pcm16' },
      stream: true,
      messages: [
        { role: 'system', content: 'Speak clearly.' },
        { role: 'user', content: 'Read this aloud:\n\nHello there.' },
      ],
    });
  });

  test('retries three times on 429 and 5xx, backing off', async () => {
    const waits: number[] = [];
    const answers = [429, 503, 500];
    const provider = openRouterProvider({
      key: 'sk-test',
      fetch: async () => {
        const status = answers.shift();
        return status ? new Response('busy', { status }) : sse(body());
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
      trim: async (wav) => wav,
    });
    await provider.synthesize('Hello there.', o);
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  test('gives up after the third retry, and at once on other errors', async () => {
    let calls = 0;
    const failing = (status: number) =>
      openRouterProvider({
        key: 'sk-test',
        fetch: async () => {
          calls += 1;
          return new Response('no', { status });
        },
        sleep: async () => {},
        trim: async (wav) => wav,
      });
    await expect(failing(503).synthesize('Hello.', o)).rejects.toThrow(/503/);
    expect(calls).toBe(4);
    calls = 0;
    await expect(failing(401).synthesize('Hello.', o)).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });

  test('a clear error when the key is unset or almost no audio comes back', async () => {
    await expect(openRouterProvider({ key: '' }).synthesize('Hello.', o)).rejects.toThrow(
      /OPENROUTER_API_KEY/
    );
    const quiet = openRouterProvider({
      key: 'sk-test',
      fetch: async () => sse([event('AAAA'), 'data: [DONE]\n\n']),
      trim: async (wav) => wav,
    });
    await expect(quiet.synthesize('Hello.', o)).rejects.toThrow(/almost no audio/);
  });

  describeFfmpeg('trimming', () => {
    test('trims the silence at both ends with ffmpeg', async () => {
      const rate = 24000;
      const samples = new Int16Array(rate * 3);
      for (let i = rate; i < rate * 2; i++) {
        samples[i] = Math.round(6000 * Math.sin((2 * Math.PI * 220 * i) / rate));
      }
      const trimmed = readWav(await trimSilence(writeWav(samples, rate)));
      expect(trimmed.sampleRate).toBe(rate);
      const seconds = trimmed.samples.length / rate;
      expect(seconds).toBeGreaterThan(0.95);
      expect(seconds).toBeLessThan(1.5);
    });
  });
});

describe('talkie voice', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'talkie-voice-'));
    await cp(FIXTURE, dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('takes a folder, a provider, one scene and a check', () => {
    expect(voiceCommand.registeredArguments.map((a) => a.name())).toEqual(['dir']);
    expect(voiceCommand.options.map((option) => option.long)).toEqual([
      '--provider',
      '--only',
      '--check',
    ]);
  });

  test('voices every line, then nothing on the second run', async () => {
    const provider = recorder();
    const first = await voiceFilm(dir, { alias: ALIAS, providers: { fake: provider } });
    expect(first.rows.map((r) => [r.scene, r.id, r.state])).toEqual([
      ['one', 'one-a', 'new'],
      ['one', 'one-b', 'new'],
      ['two', 'two-a', 'new'],
    ]);
    // the lexicon respells what is spoken
    expect(provider.said).toEqual([
      'This is a roof tile.',
      'It sits under the soff it.',
      'One nail holds it down.',
    ]);
    expect(first.rows[2].seconds).toBeCloseTo(0.4 + 5 / 2.45, 3);
    const index = JSON.parse(await readFile(join(dir, '.talkie/voice/index.json'), 'utf8'));
    // the cache keeps the written words
    expect(index['one-b'].text).toBe('It sits under the soffit.');

    const second = await voiceFilm(dir, { alias: ALIAS, providers: { fake: provider } });
    expect(second.rows.map((r) => r.state)).toEqual(['cached', 'cached', 'cached']);
    expect(provider.said).toHaveLength(3);
    expect(second.rows.map((r) => r.seconds)).toEqual(first.rows.map((r) => r.seconds));
  });

  test('accepts a folder relative to the working directory', async () => {
    const provider = recorder();
    const cwd = process.cwd();
    process.chdir(join(dir, '..'));
    try {
      const result = await voiceFilm(relative(process.cwd(), dir), {
        alias: ALIAS,
        providers: { fake: provider },
      });
      expect(result.rows).toHaveLength(3);
    } finally {
      process.chdir(cwd);
    }
  });

  test('editing a line revoices that line only', async () => {
    const provider = recorder();
    await voiceFilm(dir, { alias: ALIAS, providers: { fake: provider } });
    const file = join(dir, 'script/one.json');
    const script = JSON.parse(await readFile(file, 'utf8'));
    script.lines[0].text = 'This is a slate.';
    await writeFile(file, JSON.stringify(script));
    const again = await voiceFilm(dir, { alias: ALIAS, providers: { fake: provider } });
    expect(again.rows.map((r) => [r.id, r.state])).toEqual([
      ['one-a', 'new'],
      ['one-b', 'cached'],
      ['two-a', 'cached'],
    ]);
    expect(provider.said.slice(3)).toEqual(['This is a slate.']);
  });

  test('--only voices one scene and refuses a scene the film does not have', async () => {
    const provider = recorder();
    const result = await voiceFilm(dir, {
      alias: ALIAS,
      only: 'two',
      providers: { fake: provider },
    });
    expect(result.rows.map((r) => r.id)).toEqual(['two-a']);
    await expect(voiceFilm(dir, { alias: ALIAS, only: 'nine' })).rejects.toThrow(
      /no scene called nine/
    );
  });

  test('--check flags the lines Whisper hears differently', async () => {
    const heard = ['This is a roof tile.', 'It sits under the soffit.', 'One snail folds it gown.'];
    const result = await voiceFilm(dir, {
      alias: ALIAS,
      check: true,
      transcribe: async () => heard.shift() ?? '',
    });
    expect(result.rows.map((r) => r.flagged)).toEqual([false, false, true]);
    expect(result.rows[0].similarity).toBe(1);
    expect(result.rows[2].similarity).toBeCloseTo(0.4, 6);
    const table = voiceTable(result);
    expect(table).toContain('3 new, 0 cached, 1 flagged');
    expect(table).toMatch(
      /two-a\s+two\s+new\s+2\.44\s+0\.40 FLAG\s+heard: One snail folds it gown\./
    );
    expect(table).not.toMatch(/[–—]/);
  });

  test('prints a table without a check', async () => {
    await voiceFilm(dir, { alias: ALIAS });
    const table = voiceTable(await voiceFilm(dir, { alias: ALIAS }));
    expect(table).toMatch(/^line\s+scene\s+state\s+seconds\n/);
    expect(table).toMatch(/one-a\s+one\s+cached\s+2\.44\n/);
    expect(table).toContain('0 new, 3 cached\n');
  });

  describeFfmpeg('building', () => {
    test('the film builds from what the fake provider voiced', async () => {
      await voiceFilm(dir, { alias: ALIAS });
      const { film } = await buildFilm(dir, { alias: ALIAS });
      expect(film.scenes).toHaveLength(2);
    });
  });
});
