// yarn fixtures:talkie
//
// Writes the tiny Talkie film the tests review: test/fixtures/talkie-mini/ (folder form) and
// test/fixtures/talkie-mini.lottie (packed). Both are checked in, so tests never run this.
// Two 2 s scenes at 320x180 and 30 fps: s01 is solid red, s02 solid blue. The narration is a
// 4 s 440 Hz sine. ffmpeg runs at the lowest CPU and IO priority.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileScene, emitLottie, type LottieAnimation, scene } from '@talkie/author';
import {
  dotLottieManifest,
  mimeFor,
  packFilm,
  TALKIE_MAJOR,
  type TalkieFilm,
  validateFilm,
} from '@talkie/format';
import sharp from 'sharp';

const SIZE: [number, number] = [320, 180];
const FPS = 30;
const SCENE_SECONDS = 2;
const SCENES = [
  { id: 's01', chapter: 'Red', colour: '#ff0000', caption: 'Red scene.' },
  { id: 's02', chapter: 'Blue', colour: '#0000ff', caption: 'Blue scene.' },
];
const DURATION = SCENES.length * SCENE_SECONDS;

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
const outDir = join(fixtures, 'talkie-mini');
const packedFile = join(fixtures, 'talkie-mini.lottie');

const text = (s: string) => new TextEncoder().encode(s);
const json = (value: unknown) => text(`${JSON.stringify(value, null, 2)}\n`);

/**
 * The author library always emits 60 frames a second. These scenes hold still, so the frame rate
 * can be restated as 30 by rewriting the frame counts. A scene with keyframes would need its key
 * times rescaled too, so that is refused here.
 */
function atFixtureFps(
  animation: LottieAnimation,
  seconds: number
): Omit<LottieAnimation, 'fr'> & { fr: number } {
  const raw = JSON.stringify(animation);
  if (raw.includes('"a":1')) {
    throw new Error(`scene ${animation.nm} is animated: only still scenes can be restated`);
  }
  const op = Math.round(seconds * FPS);
  return {
    ...animation,
    fr: FPS,
    op,
    layers: animation.layers.map((layer) => ({ ...layer, op })),
  };
}

function sceneLottie(id: string, colour: string): Uint8Array {
  const def = scene(id, (c) => {
    c.add(c.rect(0, 0, SIZE[0], SIZE[1], { fill: colour }, 'fill'));
  });
  const model = compileScene(def, { size: SIZE, lines: [], duration: SCENE_SECONDS });
  return text(JSON.stringify(atFixtureFps(emitLottie(model), SCENE_SECONDS)));
}

const vttTime = (seconds: number) => `00:00:${seconds.toFixed(3).padStart(6, '0')}`;

/** ffmpeg at nice 19 and best-effort IO level 7, with no version, date or random ids in the output. */
function narration(file: string, codec: string[]): void {
  execFileSync('nice', [
    '-n',
    '19',
    'ionice',
    '-c',
    '2',
    '-n',
    '7',
    'ffmpeg',
    ...['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-threads', '1'],
    ...['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${DURATION}`],
    ...['-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-ac', '1'],
    ...codec,
    file,
  ]);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  );
}

async function main(): Promise<void> {
  const film: TalkieFilm = {
    talkie: TALKIE_MAJOR,
    title: 'Talkie mini',
    duration: DURATION,
    size: SIZE,
    // Opus first: a browser takes the first track it can play, and falls back to AAC.
    audio: ['u/narration.opus', 'u/narration.m4a'].map((src) => ({ src, type: mimeFor(src) })),
    scenes: SCENES.map(({ id }, i) => ({
      id,
      src: `a/${id}.json`,
      start: i * SCENE_SECONDS,
      end: (i + 1) * SCENE_SECONDS,
    })),
    chapters: SCENES.map(({ chapter }, i) => ({ title: chapter, start: i * SCENE_SECONDS })),
    captions: [{ lang: 'en', label: 'English', src: 'captions/en.vtt' }],
    poster: { png: 'poster.png' },
  };
  const valid = validateFilm(film);
  if (!valid.ok) {
    throw new Error(valid.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
  }

  const cues = SCENES.map(
    ({ caption }, i) =>
      `${vttTime(i * SCENE_SECONDS)} --> ${vttTime((i + 1) * SCENE_SECONDS)}\n${caption}\n`
  );
  const poster = await sharp({
    create: { width: SIZE[0], height: SIZE[1], channels: 3, background: SCENES[0].colour },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const written: Record<string, Uint8Array> = {
    'talkie.json': json(film),
    'manifest.json': json(dotLottieManifest(film)),
    'captions/en.vtt': text(['WEBVTT\n', ...cues].join('\n')),
    'poster.png': new Uint8Array(poster),
  };
  for (const { id, colour } of SCENES) {
    written[`a/${id}.json`] = sceneLottie(id, colour);
  }

  rmSync(outDir, { recursive: true, force: true });
  for (const [path, bytes] of Object.entries(written)) {
    mkdirSync(dirname(join(outDir, path)), { recursive: true });
    writeFileSync(join(outDir, path), bytes);
  }
  mkdirSync(join(outDir, 'u'), { recursive: true });
  narration(join(outDir, 'u', 'narration.opus'), ['-c:a', 'libopus', '-b:a', '32k', '-f', 'opus']);
  narration(join(outDir, 'u', 'narration.m4a'), [
    ...['-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'ipod'],
  ]);

  // The packed film is the folder, file for file.
  const files: Record<string, Uint8Array> = {};
  for (const file of walk(outDir)) {
    files[relative(outDir, file).split('\\').join('/')] = new Uint8Array(readFileSync(file));
  }
  const packed = packFilm(files);
  writeFileSync(packedFile, packed);
  console.log(`wrote ${Object.keys(files).length} files to ${outDir}`);
  console.log(`wrote ${packedFile} (${packed.byteLength} bytes)`);
}

await main();
