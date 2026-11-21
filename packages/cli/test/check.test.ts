import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { dotLottieManifest, packFilm, type TalkieFilm } from '@talkie/format';
import { checkFilm } from '../src/check';
import { checkCommand } from '../src/commands/check';

const film: TalkieFilm = {
  talkie: 1,
  title: 'Hand made',
  duration: 5,
  size: [320, 180],
  audio: [
    { src: 'u/narration.webm', type: 'audio/webm' },
    { src: 'u/narration.m4a', type: 'audio/mp4' },
  ],
  scenes: [
    { id: 'one', src: 'a/one.json', start: 0, end: 2 },
    { id: 'two', src: 'a/two.json', start: 2, end: 5 },
  ],
  chapters: [{ title: 'Start', start: 0 }],
  captions: [{ lang: 'en', label: 'English', src: 'captions/en.vtt' }],
  poster: { svg: 'poster.svg', png: 'poster.png' },
};

const text = (s: string) => new TextEncoder().encode(s);
const lottie = (frames: number) => text(JSON.stringify({ v: '5.7.0', fr: 60, ip: 0, op: frames }));

function files(): Record<string, Uint8Array> {
  return {
    'talkie.json': text(JSON.stringify(film)),
    'manifest.json': text(JSON.stringify(dotLottieManifest(film))),
    'a/one.json': lottie(120),
    'a/two.json': lottie(180),
    'u/narration.webm': Uint8Array.of(1, 2, 3),
    'u/narration.m4a': Uint8Array.of(4, 5, 6),
    'captions/en.vtt': text('WEBVTT\n'),
    'poster.svg': text('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    'poster.png': Uint8Array.of(7, 8, 9),
  };
}

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'talkie-check-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFolder(tree: Record<string, Uint8Array>): Promise<string> {
  const root = join(dir, 'film');
  for (const [path, bytes] of Object.entries(tree)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
  return root;
}
async function writePacked(tree: Record<string, Uint8Array>): Promise<string> {
  const file = join(dir, 'film.lottie');
  await writeFile(file, packFilm(tree));
  return file;
}

test('a sound film has no problems, as a folder and as a .lottie', async () => {
  expect(await checkFilm(await writeFolder(files()))).toEqual([]);
  expect(await checkFilm(await writePacked(files()))).toEqual([]);
});

test('a scene one frame out still passes; two frames out does not', async () => {
  expect(await checkFilm(await writeFolder({ ...files(), 'a/one.json': lottie(121) }))).toEqual([]);
  expect(await checkFilm(await writeFolder({ ...files(), 'a/one.json': lottie(122) }))).toEqual([
    'a/one.json runs 2.033 s, but scene one is 2 s long',
  ]);
});

test.each(['folder', 'packed'] as const)('every missing file is listed (%s)', async (form) => {
  const tree = files();
  delete tree['u/narration.m4a'];
  delete tree['a/two.json'];
  delete tree['captions/en.vtt'];
  delete tree['poster.png'];
  delete tree['poster.svg'];
  delete tree['manifest.json'];
  const target = form === 'folder' ? await writeFolder(tree) : await writePacked(tree);
  expect(await checkFilm(target)).toEqual([
    'u/narration.m4a is missing',
    'a/two.json is missing',
    'captions/en.vtt is missing',
    'poster.png is missing',
    'poster.svg is missing',
    'manifest.json is missing',
  ]);
});

test('a scene that is not a Lottie animation, and a manifest that disagrees, are problems', async () => {
  const tree = {
    ...files(),
    'a/one.json': text('{ not json'),
    'a/two.json': text('{"fr":0,"ip":0,"op":10}'),
    'manifest.json': text(JSON.stringify({ version: '2', animations: [{ id: 'one' }] })),
  };
  const problems = await checkFilm(await writeFolder(tree));
  expect(problems).toEqual([
    'a/one.json is not valid JSON',
    'a/two.json has no usable fr, ip and op',
    'manifest.json lists animations one, but the film has scenes one, two',
  ]);
});

test('an invalid talkie.json gives one problem per rule broken', async () => {
  const bad = { ...film, title: '', audio: [film.audio[0]] };
  const problems = await checkFilm(
    await writeFolder({ ...files(), 'talkie.json': text(JSON.stringify(bad)) })
  );
  expect(problems).toEqual([
    'talkie.json: title: title must be a non-empty string',
    'talkie.json: audio: every film must include an audio/mp4 (AAC) track',
  ]);
});

test('something that is not a film is a problem, not a crash', async () => {
  expect(await checkFilm(join(dir, 'nowhere'))).toEqual([`${join(dir, 'nowhere')} does not exist`]);
  await mkdir(join(dir, 'empty'));
  expect(await checkFilm(join(dir, 'empty'))).toEqual(['talkie.json is missing']);
  await writeFile(join(dir, 'junk.lottie'), 'not a zip');
  expect(await checkFilm(join(dir, 'junk.lottie'))).toEqual(['not a valid .lottie (zip) file']);
});

test('talkie check prints OK for a sound film and fails with the problems otherwise', async () => {
  const written: string[] = [];
  const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  try {
    checkCommand.exitOverride();
    const good = await writeFolder(files());
    await checkCommand.parseAsync([good], { from: 'user' });
    expect(written.join('')).toBe(`${good}: OK\n`);

    await rm(join(good, 'poster.png'));
    await expect(checkCommand.parseAsync([good], { from: 'user' })).rejects.toThrow(
      `${good}: 1 problem\n  poster.png is missing`
    );
    expect(await readFile(join(good, 'talkie.json'), 'utf8')).toContain('Hand made');
  } finally {
    spy.mockRestore();
  }
});
