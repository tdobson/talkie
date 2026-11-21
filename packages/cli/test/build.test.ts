import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { openFilm, validateFilm } from '@talkie/format';
import { writeWav } from '../src/audio/wav';
import { buildFilm } from '../src/build';
import { checkFilm } from '../src/check';
import { buildCommand } from '../src/commands/build';
import { loadConfig } from '../src/config';
import { lineIdentity, readScript, sceneOrder } from '../src/project';
import { lineHash, writeVoice } from '../src/voice-cache';

jest.setTimeout(180_000);

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
// without ffmpeg these show as skipped under the title below
const describeFfmpeg = hasFfmpeg ? describe : describe.skip;

const FIXTURE = resolve(__dirname, 'fixtures/mini-film');
/** The fixture is built in a temp folder, where the workspace packages cannot be found by name. */
const ALIAS = {
  '@talkie/author': resolve(__dirname, '../../author/src/index.ts'),
  '@talkie/cli': resolve(__dirname, '../src/config.ts'),
};
const RATE = 48000;

/** One second of a quiet tone; each line gets its own pitch. */
const sine = (hz: number) =>
  writeWav(
    Int16Array.from({ length: RATE }, (_, i) =>
      Math.round(6000 * Math.sin((2 * Math.PI * hz * i) / RATE))
    ),
    RATE
  );

/** Voice every line of the project the way `talkie voice` will: one cache entry per line. */
async function voiceAll(dir: string, skip: string[] = []) {
  const config = await loadConfig(dir, { alias: ALIAS });
  let hz = 220;
  for (const sceneId of sceneOrder(config)) {
    for (const line of (await readScript(dir, sceneId)).lines) {
      hz += 110;
      if (!skip.includes(line.id)) {
        const hash = lineHash(lineIdentity(config, line.text));
        await writeVoice(dir, line.id, { hash, wav: sine(hz), seconds: 1, text: line.text });
      }
    }
  }
}

/** Every file under a folder, as sorted relative paths mapped to bytes. */
async function tree(root: string): Promise<Record<string, Buffer>> {
  const out: Record<string, Buffer> = {};
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries.filter((e) => e.isFile())) {
    const file = join(entry.parentPath, entry.name);
    out[relative(root, file).replaceAll('\\', '/')] = await readFile(file);
  }
  return Object.fromEntries(Object.entries(out).toSorted(([a], [b]) => (a < b ? -1 : 1)));
}

let dir = '';
async function freshProject(): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), 'talkie-build-'));
  await cp(FIXTURE, project, { recursive: true });
  return project;
}
beforeEach(async () => {
  dir = await freshProject();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('a line with no voice, or a stale one, stops the build and names the lines', async () => {
  await voiceAll(dir, ['one-b']);
  // the words of two-a change after it was voiced
  const script = join(dir, 'script/two.json');
  await writeFile(script, (await readFile(script, 'utf8')).replace('One nail', 'A single nail'));
  await expect(buildFilm(dir, { alias: ALIAS })).rejects.toThrow(
    '2 lines have no current voice: one-b, two-a. Run talkie voice first.'
  );
});

test('a line id used in two scenes stops the build', async () => {
  await voiceAll(dir);
  const script = join(dir, 'script/two.json');
  await writeFile(script, (await readFile(script, 'utf8')).replace('two-a', 'one-a'));
  await expect(buildFilm(dir, { alias: ALIAS })).rejects.toThrow(
    'line id one-a is used in scene one and in scene two'
  );
});

describeFfmpeg('needs ffmpeg (skipped when ffmpeg is not on the path)', () => {
  test('build writes a film that check passes and validateFilm accepts', async () => {
    await voiceAll(dir);
    const built = await buildFilm(dir, { alias: ALIAS });
    expect(built.outDir).toBe(join(dir, 'dist/film'));
    expect(built.lottie).toBe(join(dir, 'dist/film.lottie'));
    expect(built.rebuilt).toEqual(['one', 'two']);

    const files = await tree(built.outDir);
    expect(Object.keys(files)).toEqual([
      'a/one.json',
      'a/two.json',
      'captions/en.vtt',
      'manifest.json',
      'poster.png',
      'poster.svg',
      'talkie.json',
      'u/narration.m4a',
      'u/narration.webm',
    ]);

    const json = JSON.parse(files['talkie.json'].toString());
    const valid = validateFilm(json);
    expect(valid).toEqual({ ok: true, film: json });
    expect(json).toEqual(built.film);
    // one: lead 1.4, captions held 3.167 s (5 words) and 3.5 s (6 words) with a 0.7 s gap, tail 2.2.
    // two: 1.4 + 3.167 + 2.2 is under its minDuration of 8.
    expect(json).toEqual({
      talkie: 1,
      title: 'Mini film',
      duration: 18.967,
      size: [320, 180],
      audio: [
        { src: 'u/narration.webm', type: 'audio/webm' },
        { src: 'u/narration.m4a', type: 'audio/mp4' },
      ],
      scenes: [
        { id: 'one', src: 'a/one.json', start: 0, end: 10.967 },
        { id: 'two', src: 'a/two.json', start: 10.967, end: 18.967 },
      ],
      chapters: [
        { title: 'The tile', start: 0 },
        { title: 'The nail', start: 10.967 },
      ],
      captions: [{ lang: 'en', label: 'English', src: 'captions/en.vtt' }],
      poster: { svg: 'poster.svg', png: 'poster.png' },
    });
    expect(JSON.parse(files['manifest.json'].toString())).toEqual({
      version: '2',
      generator: 'talkie',
      animations: [{ id: 'one' }, { id: 'two' }],
    });

    // captions are on the film clock, and show the caption text where the script gives one
    expect(files['captions/en.vtt'].toString()).toBe(
      [
        'WEBVTT\n',
        '00:00:01.400 --> 00:00:04.567\nThis is a roof tile.\n',
        '00:00:05.267 --> 00:00:08.767\nIt sits under the soffit board.\n',
        '00:00:12.367 --> 00:00:15.534\nOne nail holds it down.\n',
      ].join('\n')
    );

    const one = JSON.parse(files['a/one.json'].toString());
    expect([one.w, one.h, one.fr, one.ip, one.op]).toEqual([320, 180, 60, 0, 658]);
    expect(files['poster.svg'].toString()).toMatch(/^<svg /);
    // PNG signature, then the IHDR width and height: 1280 wide, 16:9
    expect(files['poster.png'].subarray(1, 4).toString()).toBe('PNG');
    expect(files['poster.png'].readUInt32BE(16)).toBe(1280);
    expect(files['poster.png'].readUInt32BE(20)).toBe(720);

    expect(await checkFilm(built.outDir)).toEqual([]);
    expect(await checkFilm(built.lottie)).toEqual([]);

    // the .lottie holds the same film
    const packed = await openFilm(new Uint8Array(await readFile(built.lottie)));
    expect(packed.film).toEqual(json);
    expect(await packed.source.json('a/two.json')).toEqual(
      JSON.parse(files['a/two.json'].toString())
    );
    packed.source.dispose();
  });

  test('building twice gives the same bytes, from the cache and from scratch', async () => {
    await voiceAll(dir);
    const first = await buildFilm(dir, { alias: ALIAS });
    const before = await tree(join(dir, 'dist'));

    const second = await buildFilm(dir, { alias: ALIAS });
    expect(second.rebuilt).toEqual([]);
    expect(await tree(join(dir, 'dist'))).toEqual(before);

    // a second copy of the project, built cold in another folder
    const other = await freshProject();
    try {
      await voiceAll(other);
      const cold = await buildFilm(other, { alias: ALIAS });
      expect(cold.rebuilt).toEqual(first.rebuilt);
      expect(await tree(join(other, 'dist'))).toEqual(before);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  test('only a scene whose source, script, voice or art changed is rebuilt', async () => {
    await voiceAll(dir);
    await buildFilm(dir, { alias: ALIAS });
    const rebuild = async () => (await buildFilm(dir, { alias: ALIAS })).rebuilt;
    const edit = async (file: string, from: string, to: string) => {
      const text = await readFile(join(dir, file), 'utf8');
      expect(text).toContain(from);
      await writeFile(join(dir, file), text.replace(from, to));
    };
    const lottie = (id: string) => readFile(join(dir, `dist/film/a/${id}.json`), 'utf8');
    const oneBefore = await lottie('one');
    const twoBefore = await lottie('two');

    // source
    await edit('scenes/two.ts', '[120, 50]', '[100, 50]');
    expect(await rebuild()).toEqual(['two']);
    expect(await lottie('one')).toBe(oneBefore);
    expect(await lottie('two')).not.toBe(twoBefore);

    // art, found through what the scene loaded last time
    await edit('art/tile.svg', '#8a4b2a', '#7a3b1a');
    expect(await rebuild()).toEqual(['one']);
    expect(await lottie('one')).not.toBe(oneBefore);

    // script: a longer scene moves the next one, but does not rebuild it
    await edit('script/one.json', '"lines"', '"minDuration": 12, "lines"');
    expect(await rebuild()).toEqual(['one']);
    const film = JSON.parse(await readFile(join(dir, 'dist/film/talkie.json'), 'utf8'));
    expect(film.scenes.map((s: { start: number }) => s.start)).toEqual([0, 12]);
    expect(film.duration).toBe(20);

    // voice: the same words voiced again, longer
    const config = await loadConfig(dir, { alias: ALIAS });
    const text = 'One nail holds it down.';
    const hash = lineHash(lineIdentity(config, text));
    const longer = writeWav(new Int16Array(RATE * 1.5).fill(500), RATE);
    await writeVoice(dir, 'two-a', { hash, wav: longer, seconds: 1.5, text });
    expect(await rebuild()).toEqual(['two']);

    expect(await rebuild()).toEqual([]);
    expect(await checkFilm(join(dir, 'dist/film'))).toEqual([]);
  });

  test('a drawing the converter cannot represent fails the build', async () => {
    await voiceAll(dir);
    await writeFile(
      join(dir, 'art/tile.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text id="t" x="0" y="5">Tile</text></svg>'
    );
    await expect(buildFilm(dir, { alias: ALIAS })).rejects.toThrow(/text/);
  });

  test('talkie build takes the folder and the Opus container', async () => {
    await voiceAll(dir);
    const written: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const before = process.env.JITI_ALIAS;
    process.env.JITI_ALIAS = JSON.stringify(ALIAS);
    try {
      buildCommand.exitOverride().configureOutput({ writeErr: () => {} });
      await buildCommand.parseAsync([dir, '--opus', 'ogg'], { from: 'user' });
    } finally {
      spy.mockRestore();
      if (before === undefined) {
        delete process.env.JITI_ALIAS;
      } else {
        process.env.JITI_ALIAS = before;
      }
    }
    expect(written.join('')).toBe(
      `Built Mini film: 2 scenes (2 rebuilt), 18.967 s\n  ${join(dir, 'dist/film')}\n  ${join(dir, 'dist/film.lottie')}\n`
    );
    const film = JSON.parse(await readFile(join(dir, 'dist/film/talkie.json'), 'utf8'));
    expect(film.audio).toEqual([
      { src: 'u/narration.ogg', type: 'audio/ogg' },
      { src: 'u/narration.m4a', type: 'audio/mp4' },
    ]);
    expect(await checkFilm(join(dir, 'dist/film'))).toEqual([]);
    await expect(
      buildCommand.parseAsync([dir, '--opus', 'mp3'], { from: 'user' })
    ).rejects.toThrow();
  });
});
