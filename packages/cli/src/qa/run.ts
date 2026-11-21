import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { compileScene, planLines, type LineInput, type Node } from '@talkie/author';
import type { TalkieFilm } from '@talkie/format';
import { measureLoudness } from '../audio/measure';
import { buildFilm, type BuildOptions } from '../build';
import { checkFilm } from '../check';
import { loadConfig, type LoadOptions, type ResolvedConfig } from '../config';
import {
  artLoaders,
  lineIdentity,
  loadScene,
  readScript,
  sceneOrder,
  type Script,
} from '../project';
import { lineHash, readVoice } from '../voice-cache';
import {
  bandGate,
  captionGate,
  checkGate,
  dashGate,
  loudnessGates,
  sizeReport,
  stillGate,
  voiceGate,
  type Gate,
  type QaScene,
  type TrackLoudness,
} from './gates';

export interface QaResult {
  gates: Gate[];
  /** False when any gate failed. */
  ok: boolean;
}

/** The tail `planLines` leaves at the end of a scene when the config does not set one, in seconds. */
const DEFAULT_TAIL = 2.2;
/** Names the author package gives the nodes that `label()` makes. */
const LABEL_PREFIX = 'label ';

interface ScriptedScene {
  id: string;
  script: Script;
  /** Every line with a voice length: the cached one, a stale one, or a guess. */
  inputs: LineInput[];
}

/** The length of a line's voice as the cache has it, whether or not it is current. */
async function cachedSeconds(projectDir: string, lineId: string): Promise<number | null> {
  try {
    const index = JSON.parse(
      await readFile(join(projectDir, '.talkie', 'voice', 'index.json'), 'utf8')
    );
    const seconds = Object.hasOwn(index, lineId) ? index[lineId]?.seconds : undefined;
    return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  } catch {
    return null;
  }
}

/** Read the scripts and look every line up in the voice cache. */
async function readScenes(
  projectDir: string,
  config: ResolvedConfig
): Promise<{ scenes: ScriptedScene[]; problems: string[] }> {
  const scenes: ScriptedScene[] = [];
  const problems: string[] = [];
  for (const id of sceneOrder(config)) {
    const script = await readScript(projectDir, id);
    const inputs: LineInput[] = [];
    for (const line of script.lines) {
      const voice = await readVoice(projectDir, line.id, lineHash(lineIdentity(config, line.text)));
      let seconds = voice?.seconds;
      if (seconds === undefined) {
        const old = await cachedSeconds(projectDir, line.id);
        problems.push(`line ${line.id}: ${old === null ? 'no voice' : 'the voice is stale'}`);
        // a guess at three words a second keeps the picture gates running
        seconds = old ?? (line.text.match(/\S+/g) ?? []).length / 3;
      }
      inputs.push({ ...line, voiceSeconds: seconds });
    }
    scenes.push({ id, script, inputs });
  }
  return { scenes, problems };
}

/** Compile every scene as the build does. A scene that will not compile is a problem, not a crash. */
async function compileScenes(
  projectDir: string,
  config: ResolvedConfig,
  scenes: ScriptedScene[],
  opts: LoadOptions
): Promise<{ models: QaScene[]; problems: string[] }> {
  const models: QaScene[] = [];
  const problems: string[] = [];
  for (const { id, script, inputs } of scenes) {
    try {
      const plan = planLines(inputs, {
        ...config.timing,
        ...(script.minDuration === undefined ? {} : { minDuration: script.minDuration }),
      });
      const model = compileScene(await loadScene(projectDir, id, opts), {
        size: config.size,
        lines: plan.lines,
        duration: plan.duration,
        loaders: artLoaders(projectDir, config).loaders,
        conflicts: config.conflicts,
      });
      models.push({ id, model });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`scene ${id} did not compile: ${message}`);
    }
  }
  return { models, problems };
}

function labelTexts(nodes: Node[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.name.startsWith(LABEL_PREFIX) ? [node.name.slice(LABEL_PREFIX.length)] : []),
    ...labelTexts(node.children),
  ]);
}

/** The film in `dist/film`, when it is there and its `talkie.json` reads. */
async function readBuiltFilm(outDir: string): Promise<TalkieFilm | null> {
  try {
    return JSON.parse(await readFile(join(outDir, 'talkie.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Run every gate on a film project. When every line has a current voice the film is built first,
 * so the gates see the project as it stands; otherwise they look at the film already in `dist/`.
 * The size report is not a gate and never fails.
 */
export async function runQa(dir: string, opts: BuildOptions = {}): Promise<QaResult> {
  const projectDir = resolve(dir);
  const { opus: _opus, ...load } = opts;
  const config = await loadConfig(projectDir, load);
  const { scenes, problems: voiceProblems } = await readScenes(projectDir, config);

  const outDir = join(projectDir, 'dist', 'film');
  const packed = join(projectDir, 'dist', 'film.lottie');
  if (voiceProblems.length === 0) {
    await buildFilm(projectDir, opts);
  }
  const checkProblems = await checkFilm(outDir);
  if (await stat(packed).catch(() => null)) {
    checkProblems.push(...(await checkFilm(packed)).map((p) => `film.lottie: ${p}`));
  }
  const film = checkProblems.length === 0 ? await readBuiltFilm(outDir) : null;

  const captions = scenes.flatMap(({ script }) =>
    script.lines.map((line) => ({ id: line.id, text: line.caption ?? line.text }))
  );

  const { models, problems: compileProblems } = await compileScenes(
    projectDir,
    config,
    scenes,
    load
  );
  const picture = (made: Gate): Gate =>
    compileProblems.length === 0
      ? made
      : { ...made, status: 'FAIL', details: [...compileProblems, ...made.details] };

  const dashes = dashGate([
    { where: 'the film title', text: config.title },
    ...config.chapters.map((chapter, n) => ({
      where: `the title of chapter ${n + 1}`,
      text: chapter.title,
    })),
    ...scenes.flatMap(({ id, script }) =>
      script.lines.flatMap((line) => [
        { where: `script ${id}, line ${line.id}`, text: line.text },
        ...(line.caption === undefined
          ? []
          : [{ where: `script ${id}, the caption of line ${line.id}`, text: line.caption }]),
      ])
    ),
    ...models.flatMap(({ id, model }) =>
      labelTexts(model.nodes).map((text) => ({ where: `scene ${id}, a label`, text }))
    ),
  ]);

  let loudness: [Gate, Gate];
  let size: Gate;
  if (film) {
    const file = (src: string) => join(outDir, ...src.split('/'));
    const tracks: TrackLoudness[] = [];
    const audio: Array<{ src: string; bytes: number }> = [];
    for (const { src } of film.audio) {
      tracks.push({ src, ...(await measureLoudness(file(src))) });
      audio.push({ src, bytes: (await stat(file(src))).size });
    }
    let animation = 0;
    for (const scene of film.scenes) {
      animation += brotliCompressSync(await readFile(file(scene.src))).length;
    }
    loudness = loudnessGates(tracks);
    size = sizeReport({ animation, scenes: film.scenes.length, audio, duration: film.duration });
  } else {
    const none = ['not measured: there is no sound built film in dist/film'];
    loudness = [
      { name: 'loudness', status: 'FAIL', details: none },
      { name: 'true peak', status: 'FAIL', details: none },
    ];
    size = { name: 'size', status: 'INFO', details: none };
  }

  const gates = [
    checkGate(checkProblems),
    voiceGate(voiceProblems),
    captionGate(captions),
    dashes,
    ...loudness,
    picture(stillGate(models, config.timing.tail ?? DEFAULT_TAIL)),
    picture(bandGate(models)),
    size,
  ];
  return { gates, ok: gates.every((gate) => gate.status !== 'FAIL') };
}
