import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  compileScene,
  emitLottie,
  planLines,
  svgAt,
  type LineInput,
  type PlannedLine,
} from '@talkie/author';
import {
  dotLottieManifest,
  mimeFor,
  packFilm,
  TALKIE_MAJOR,
  validateFilm,
  type TalkieFilm,
} from '@talkie/format';
import { masterNarration } from './audio/master';
import { mixScene } from './audio/mix';
import { LINE_RATE, normaliseLine, writeWav } from './audio/wav';
import { buildVtt, type VttLine } from './captions/vtt';
import { loadConfig, type LoadOptions, type ResolvedConfig } from './config';
import { rasterisePoster } from './poster';
import {
  artHash,
  artLoaders,
  fontHash,
  lineIdentity,
  loadScene,
  readScript,
  sceneOrder,
  sceneSourceHash,
  sha256,
  type Script,
} from './project';
import { lineHash, readVoice } from './voice-cache';

export interface BuildOptions extends LoadOptions {
  /** Container of the Opus track. Default 'webm'. */
  opus?: 'webm' | 'ogg';
}
export interface BuildResult {
  /** The film in folder form: `<project>/dist/film`. */
  outDir: string;
  /** The same film packed: `<project>/dist/film.lottie`. */
  lottie: string;
  film: TalkieFilm;
  /** Scenes compiled in this run, in film order. The rest came from the cache. */
  rebuilt: string[];
}

/** Raise this when a change to the build makes old cache entries wrong. */
const CACHE_VERSION = 1;

/** What the cache remembers about a built scene, in `.talkie/build/<sceneId>.json`. */
interface SceneRecord {
  key: string;
  /** Drawings the scene loaded when it was built. */
  art: string[];
  /** Whether the scene drew a label, and so read the font. */
  font: boolean;
}
interface PlannedScene {
  id: string;
  script: Script;
  voices: Array<{ id: string; file: string }>;
  lines: PlannedLine[];
  duration: number;
}
interface BuiltScene extends PlannedScene {
  lottie: Uint8Array;
  wav: string;
  poster: string;
}

const text = (s: string) => new TextEncoder().encode(s);
const json = (value: unknown) => text(`${JSON.stringify(value, null, 2)}\n`);
const ms = (seconds: number) => Math.round(seconds * 1000);

async function readIfThere(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function captionsLabel(lang: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}

/** Read every scene's script and voice, and place the lines on each scene's clock. */
async function planScenes(projectDir: string, config: ResolvedConfig): Promise<PlannedScene[]> {
  const scenes: PlannedScene[] = [];
  const owner = new Map<string, string>();
  const unvoiced: string[] = [];
  for (const id of sceneOrder(config)) {
    const script = await readScript(projectDir, id);
    const voices: PlannedScene['voices'] = [];
    const inputs: LineInput[] = [];
    for (const line of script.lines) {
      const other = owner.get(line.id);
      if (other !== undefined && other !== id) {
        throw new Error(`line id ${line.id} is used in scene ${other} and in scene ${id}`);
      }
      owner.set(line.id, id);
      const voice = await readVoice(projectDir, line.id, lineHash(lineIdentity(config, line.text)));
      if (voice) {
        voices.push({ id: line.id, file: voice.file });
        inputs.push({ ...line, voiceSeconds: voice.seconds });
      } else {
        unvoiced.push(line.id);
      }
    }
    if (unvoiced.length === 0) {
      const plan = planLines(inputs, {
        ...config.timing,
        ...(script.minDuration === undefined ? {} : { minDuration: script.minDuration }),
      });
      scenes.push({ id, script, voices, lines: plan.lines, duration: plan.duration });
    }
  }
  if (unvoiced.length > 0) {
    const count = unvoiced.length === 1 ? '1 line has' : `${unvoiced.length} lines have`;
    throw new Error(`${count} no current voice: ${unvoiced.join(', ')}. Run talkie voice first.`);
  }
  return scenes;
}

/** Build one scene, or take it from `.talkie/build/` when nothing it depends on has changed. */
async function buildScene(
  projectDir: string,
  config: ResolvedConfig,
  planned: PlannedScene,
  allIds: string[],
  opts: LoadOptions
): Promise<{ scene: BuiltScene; rebuilt: boolean }> {
  const { id } = planned;
  const cacheDir = join(projectDir, '.talkie', 'build');
  const recordFile = join(cacheDir, `${id}.json`);
  const lottieFile = join(cacheDir, `${id}.lottie.json`);
  const wav = join(cacheDir, `${id}.wav`);
  const posterFile = join(cacheDir, `${id}.poster.svg`);

  const voice = [];
  for (const v of planned.voices) {
    voice.push([v.id, sha256(await readFile(v.file))]);
  }
  const fixed = {
    version: CACHE_VERSION,
    size: config.size,
    conflicts: config.conflicts,
    source: await sceneSourceHash(projectDir, id, allIds),
    script: planned.script.hash,
    lines: planned.lines,
    duration: planned.duration,
    voice,
  };
  const keyFor = (art: string[], font: boolean) =>
    sha256(
      JSON.stringify({
        ...fixed,
        art: art.map((name) => [name, artHash(projectDir, name)]),
        font: font ? fontHash(projectDir, config) : null,
      })
    );

  const recordBytes = await readIfThere(recordFile);
  if (recordBytes) {
    let record: SceneRecord | null = null;
    try {
      record = JSON.parse(recordBytes.toString('utf8'));
    } catch {
      // a damaged record is the same as none
    }
    if (
      record &&
      Array.isArray(record.art) &&
      record.key === keyFor(record.art, record.font === true)
    ) {
      const [lottie, poster, audio] = await Promise.all(
        [lottieFile, posterFile, wav].map(readIfThere)
      );
      if (lottie && poster && audio) {
        const scene = {
          ...planned,
          lottie: new Uint8Array(lottie),
          wav,
          poster: poster.toString(),
        };
        return { scene, rebuilt: false };
      }
    }
  }

  const def = await loadScene(projectDir, id, opts);
  const { loaders, used } = artLoaders(projectDir, config);
  const model = compileScene(def, {
    size: config.size,
    lines: planned.lines,
    duration: planned.duration,
    loaders,
    conflicts: config.conflicts,
  });
  const lottie = text(JSON.stringify(emitLottie(model)));
  const poster = svgAt(model, 0);

  const starts = new Map(planned.lines.map((line) => [line.id, line.start]));
  const voiced = [];
  for (const v of planned.voices) {
    const { samples } = await normaliseLine(v.file);
    voiced.push({ start: starts.get(v.id)!, samples });
  }
  const mixed = writeWav(mixScene(voiced, planned.duration, LINE_RATE), LINE_RATE);

  const art = [...used.art.keys()].toSorted((a, b) => (a < b ? -1 : 1));
  const record: SceneRecord = {
    key: keyFor(art, used.font !== null),
    art,
    font: used.font !== null,
  };
  await mkdir(cacheDir, { recursive: true });
  // the record goes first and comes back last, so a build that stops half way leaves no entry
  await rm(recordFile, { force: true });
  await writeFile(lottieFile, lottie);
  await writeFile(posterFile, poster);
  await writeFile(wav, mixed);
  await writeFile(recordFile, json(record));
  return { scene: { ...planned, lottie, wav, poster }, rebuilt: true };
}

/**
 * Build a film project into `dist/film/` (folder form) and `dist/film.lottie`. The same project
 * gives the same bytes every time.
 */
export async function buildFilm(dir: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const projectDir = resolve(dir);
  const { opus = 'webm', ...load } = opts;
  const config = await loadConfig(projectDir, load);
  const planned = await planScenes(projectDir, config);
  const allIds = planned.map((scene) => scene.id);

  const scenes: BuiltScene[] = [];
  const rebuilt: string[] = [];
  for (const plan of planned) {
    const built = await buildScene(projectDir, config, plan, allIds, load);
    scenes.push(built.scene);
    if (built.rebuilt) {
      rebuilt.push(plan.id);
    }
  }

  // Whole milliseconds are summed, so a long film does not drift by rounding.
  const startMs = new Map<string, number>();
  let totalMs = 0;
  for (const scene of scenes) {
    startMs.set(scene.id, totalMs);
    totalMs += ms(scene.duration);
  }
  const startOf = (id: string) => startMs.get(id)! / 1000;
  const lang = config.captionsLang;
  const captionsSrc = `captions/${lang}.vtt`;

  const film: TalkieFilm = {
    talkie: TALKIE_MAJOR,
    title: config.title,
    duration: totalMs / 1000,
    size: config.size,
    // Opus first: a browser takes the first track it can play, and falls back to AAC
    audio: [`u/narration.${opus}`, 'u/narration.m4a'].map((src) => ({ src, type: mimeFor(src) })),
    scenes: scenes.map((scene) => ({
      id: scene.id,
      src: `a/${scene.id}.json`,
      start: startOf(scene.id),
      end: (startMs.get(scene.id)! + ms(scene.duration)) / 1000,
    })),
    chapters: config.chapters.map((chapter) => ({
      title: chapter.title,
      start: startOf(chapter.scenes[0]),
    })),
    captions: [{ lang, label: captionsLabel(lang), src: captionsSrc }],
    poster: { svg: 'poster.svg', png: 'poster.png' },
  };
  const valid = validateFilm(film);
  if (!valid.ok) {
    throw new Error(
      `the film would not be valid: ${valid.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`
    );
  }

  const cues: VttLine[] = scenes.flatMap((scene) =>
    scene.lines.map((line) => {
      const at = (seconds: number) => (startMs.get(scene.id)! + ms(seconds)) / 1000;
      return {
        start: at(line.start),
        voiceEnd: at(line.voiceEnd),
        captionEnd: at(line.captionEnd),
        text: line.text,
        ...(line.caption === undefined ? {} : { caption: line.caption }),
      };
    })
  );

  const files: Record<string, Uint8Array> = {
    'talkie.json': json(film),
    'manifest.json': json(dotLottieManifest(film)),
    [captionsSrc]: text(buildVtt(cues)),
    'poster.svg': text(scenes[0].poster),
    'poster.png': rasterisePoster(scenes[0].poster),
  };
  for (const scene of scenes) {
    files[`a/${scene.id}.json`] = scene.lottie;
  }

  const outDir = join(projectDir, 'dist', 'film');
  const lottie = join(projectDir, 'dist', 'film.lottie');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const mastered = await masterNarration(
    scenes.map((scene) => scene.wav),
    outDir,
    { opusContainer: opus }
  );
  if (Math.abs(mastered.seconds - film.duration) > 0.001) {
    throw new Error(
      `the narration is ${mastered.seconds} s long, but the scenes add up to ${film.duration} s`
    );
  }
  for (const track of film.audio) {
    files[track.src] = new Uint8Array(await readFile(join(outDir, ...track.src.split('/'))));
  }
  for (const [path, bytes] of Object.entries(files)) {
    const file = join(outDir, ...path.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  await writeFile(lottie, packFilm(files));
  return { outDir, lottie, film, rebuilt };
}
