import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getPriority, hostname as osHostname, setPriority, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frameFor, openFilm, sceneAt, type TalkieFilm } from '@talkie/format';
import { chromium } from 'playwright-core';
import { runLow } from '../audio/lowproc';
import { formatVttTime } from '../captions/vtt';
import {
  contentType,
  findDotLottieDist,
  findPlayerDist,
  safeJoin,
  sendBytes,
  sendFile,
  sendNotFound,
} from '../dev/server';
import { renderPage } from './render-page';

// ---------------------------------------------------------------------------------------------
// Arguments

export type Codec = 'h264' | 'h265' | 'av1';
export type AudioCodec = 'aac' | 'opus';
export type CaptionMode = 'burn' | 'track' | 'none';
export type Container = 'mp4' | 'mkv' | 'webm';

/** Options as the command line gives them: every value still a string. */
export interface ExportOptions {
  out: string;
  codec?: string;
  audio?: string;
  size?: string;
  from?: string;
  to?: string;
  captions?: string;
  fps?: string;
  allowHere?: boolean;
}

/** A checked export: what will be rendered and how it will be encoded. */
export interface ExportPlan {
  out: string;
  container: Container;
  codec: Codec;
  audio: AudioCodec;
  size: [number, number];
  /** Film seconds of the first frame. */
  from: number;
  /** Film seconds the export stops at. */
  to: number;
  captions: CaptionMode;
  fps: number;
  frames: number;
}

const SIZES: Record<string, [number, number]> = {
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '4k': [3840, 2160],
};

/** Read `--size`: 720p, 1080p, 4k or `<W>x<H>`. Both sides must be even, as yuv420p needs. */
export function parseSize(text: string): [number, number] {
  const named = SIZES[text.toLowerCase()];
  if (named) {
    return named;
  }
  const match = /^(\d{1,5})x(\d{1,5})$/i.exec(text);
  if (!match || Number(match[1]) === 0 || Number(match[2]) === 0) {
    throw new Error('size must be 720p, 1080p, 4k or <W>x<H>, for example 1280x720');
  }
  const size: [number, number] = [Number(match[1]), Number(match[2])];
  if (size[0] % 2 !== 0 || size[1] % 2 !== 0) {
    throw new Error(`size ${text}: width and height must be even`);
  }
  return size;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function seconds(text: string, flag: string): number {
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n) || n < 0) {
    throw new Error(`${flag} must be a time in seconds, zero or more`);
  }
  return n;
}

/** Check the options against each other and the film's length, and fill in the defaults. */
export function resolveExport(opts: ExportOptions, duration: number): ExportPlan {
  const ext = extname(opts.out).toLowerCase();
  if (ext !== '.mp4' && ext !== '.mkv' && ext !== '.webm') {
    throw new Error('the output must end in .mp4, .mkv or .webm');
  }
  const container = ext.slice(1) as Container;

  const codec = opts.codec ?? 'h264';
  if (codec !== 'h264' && codec !== 'h265' && codec !== 'av1') {
    throw new Error('codec must be h264, h265 or av1');
  }
  const audio = opts.audio ?? (container === 'webm' ? 'opus' : 'aac');
  if (audio !== 'aac' && audio !== 'opus') {
    throw new Error('audio must be aac or opus');
  }
  const captions = opts.captions ?? 'none';
  if (captions !== 'burn' && captions !== 'track' && captions !== 'none') {
    throw new Error('captions must be burn, track or none');
  }
  if (container === 'webm' && codec !== 'av1') {
    throw new Error('a .webm output needs --codec av1');
  }
  if (container === 'webm' && audio !== 'opus') {
    throw new Error('a .webm output needs --audio opus');
  }
  if (container === 'mp4' && audio === 'opus') {
    throw new Error('Opus audio needs an .mkv or .webm output');
  }

  const fps = Number(opts.fps ?? '25');
  if (!Number.isFinite(fps) || fps < 1 || fps > 120) {
    throw new Error('fps must be a number from 1 to 120');
  }
  const from = opts.from === undefined ? 0 : seconds(opts.from, '--from');
  if (from >= duration) {
    throw new Error(`--from is past the end of the film (${round3(duration)} s)`);
  }
  const to = Math.min(opts.to === undefined ? duration : seconds(opts.to, '--to'), duration);
  if (to <= from) {
    throw new Error('--to must be after --from');
  }

  return {
    out: opts.out,
    container,
    codec,
    audio,
    size: parseSize(opts.size ?? '1080p'),
    from,
    to,
    captions,
    fps,
    frames: Math.max(1, Math.round((to - from) * fps)),
  };
}

/** `talkie export` must not run on the shared desktop unless `--allow-here` says so. */
export function assertRenderBox(hostname: string, allowHere: boolean): void {
  const host = hostname.toLowerCase().split('.')[0];
  if (host === 'tragicomix' && !allowHere) {
    throw new Error('Render on xebit-dev1, xebit-dev3 or asterix, not tragicomix');
  }
}

const VIDEO_ARGS: Record<Codec, string[]> = {
  h264: ['-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-pix_fmt', 'yuv420p'],
  h265: [
    ...['-c:v', 'libx265', '-crf', '26', '-preset', 'medium'],
    ...['-tag:v', 'hvc1', '-pix_fmt', 'yuv420p'],
  ],
  av1: ['-c:v', 'libsvtav1', '-crf', '35', '-preset', '8', '-pix_fmt', 'yuv420p'],
};
const AOM_ARGS = [
  ...['-c:v', 'libaom-av1', '-crf', '35', '-b:v', '0', '-cpu-used', '6'],
  ...['-pix_fmt', 'yuv420p'],
];

export interface FfmpegInputs {
  /** The narration file to copy from. */
  audio: string;
  /** A WebVTT file whose times already start at the export's first frame, or null. */
  subtitles: string | null;
  /** Whether this ffmpeg has libsvtav1. Without it AV1 falls back to libaom. */
  svtav1: boolean;
}

/** The ffmpeg command line: PNG frames on stdin, the narration copied, captions as a track. */
export function ffmpegArgs(plan: ExportPlan, inputs: FfmpegInputs): string[] {
  const length = String(round3(plan.frames / plan.fps));
  const video = plan.codec === 'av1' && !inputs.svtav1 ? AOM_ARGS : VIDEO_ARGS[plan.codec];
  return [
    ...['-y', '-loglevel', 'error'],
    ...['-f', 'image2pipe', '-framerate', String(plan.fps), '-c:v', 'png', '-i', '-'],
    ...['-ss', String(round3(plan.from)), '-t', length, '-i', inputs.audio],
    ...(inputs.subtitles ? ['-i', inputs.subtitles] : []),
    ...['-map', '0:v:0', '-map', '1:a:0'],
    ...(inputs.subtitles ? ['-map', '2:s:0'] : []),
    ...video,
    ...['-c:a', 'copy'],
    ...(inputs.subtitles ? ['-c:s', plan.container === 'mp4' ? 'mov_text' : 'webvtt'] : []),
    ...['-t', length],
    ...(plan.container === 'mp4' ? ['-movflags', '+faststart'] : []),
    plan.out,
  ];
}

// ---------------------------------------------------------------------------------------------
// Captions

export interface ExportCue {
  start: number;
  end: number;
  /** Plain text: WebVTT tags dropped and entities decoded. */
  text: string;
}

const CUE_TIME =
  /^\s*(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})/;

const plainCue = (text: string) =>
  text
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/** Read the cues of a WebVTT file, in file order. */
export function parseCues(vtt: string): ExportCue[] {
  const cues: ExportCue[] = [];
  for (const block of vtt.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((line) => CUE_TIME.test(line));
    if (at < 0) {
      continue;
    }
    const m = CUE_TIME.exec(lines[at]!)!;
    const time = (h: string | undefined, min: string, s: string, ms: string) =>
      Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s) + Number(ms) / 1000;
    cues.push({
      start: time(m[1], m[2]!, m[3]!, m[4]!),
      end: time(m[5], m[6]!, m[7]!, m[8]!),
      text: plainCue(lines.slice(at + 1).join('\n')).trim(),
    });
  }
  return cues;
}

/** The caption on screen at film time t, or '' when there is none. */
export function captionAt(cues: ExportCue[], t: number): string {
  let text = '';
  for (const cue of cues) {
    if (cue.start <= t && t < cue.end) {
      text = cue.text;
    }
  }
  return text;
}

/** A WebVTT file of the cues inside [from, to), with times counted from `from`. */
function shiftedVtt(cues: ExportCue[], from: number, to: number): string {
  const escape = (text: string) =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const blocks = cues
    .filter((cue) => cue.end > from && cue.start < to)
    .map((cue) => {
      const start = formatVttTime(Math.max(cue.start, from) - from);
      const end = formatVttTime(Math.min(cue.end, to) - from);
      return `${start} --> ${end}\n${escape(cue.text)}\n`;
    });
  return ['WEBVTT\n', ...blocks].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Held frames
//
// The plan asks for the author's activeAt(model, t) here. Export is given a built film, which has
// no scene models, so the same question is asked of the Lottie JSON: between two frames, does any
// keyframe segment change value, or any layer come in or go out? If not, the picture is the same
// and the PNG before it is sent again without drawing.

export interface SceneActivity {
  /** Lottie frame ranges [start, end] in which some property is changing. */
  spans: Array<[number, number]>;
  /** Lottie frames at which the picture jumps: a layer comes in or goes out, or a hold ends. */
  cuts: number[];
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const isKeyframes = (k: unknown): k is Array<Record<string, unknown>> =>
  Array.isArray(k) && k.length > 0 && k.every((key) => isObject(key) && typeof key.t === 'number');

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const allZero = (x: unknown): boolean =>
  x === undefined || (Array.isArray(x) ? x.every(allZero) : x === 0);

/**
 * When a scene's picture changes, read from its Lottie JSON. null means "cannot tell, treat every
 * frame as new": the scene uses expressions or precomps, whose timing this does not follow.
 */
export function sceneActivity(animation: unknown): SceneActivity | null {
  if (!isObject(animation)) {
    return null;
  }
  if (
    Array.isArray(animation.assets) &&
    animation.assets.some((a) => isObject(a) && 'layers' in a)
  ) {
    return null;
  }
  const first = typeof animation.ip === 'number' ? animation.ip : -Infinity;
  const last = typeof animation.op === 'number' ? animation.op : Infinity;
  const spans: Array<[number, number]> = [];
  const cuts = new Set<number>();
  let unknown = false;

  const visit = (node: unknown, isLayer: boolean): void => {
    if (unknown) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, false));
      return;
    }
    if (!isObject(node)) {
      return;
    }
    if (typeof node.x === 'string') {
      unknown = true;
      return;
    }
    if (isLayer) {
      if (node.ty === 0 || 'tm' in node) {
        unknown = true;
        return;
      }
      for (const edge of [node.ip, node.op]) {
        if (typeof edge === 'number' && edge > first && edge < last) {
          cuts.add(edge);
        }
      }
    }
    if (isKeyframes(node.k)) {
      node.k.forEach((key, n) => {
        const next = (node.k as Array<Record<string, unknown>>)[n + 1];
        if (!next) {
          return;
        }
        const t = key.t as number;
        const end = next.t as number;
        if (key.h === 1) {
          cuts.add(end);
        } else if (
          !same(key.s, next.s) ||
          (key.e !== undefined && !same(key.s, key.e)) ||
          !allZero(key.to) ||
          !allZero(key.ti)
        ) {
          spans.push([t, end]);
        }
      });
    }
    for (const [name, value] of Object.entries(node)) {
      if (name === 'layers' && Array.isArray(value)) {
        value.forEach((layer) => visit(layer, true));
      } else {
        visit(value, false);
      }
    }
  };
  visit({ layers: animation.layers }, false);
  if (unknown) {
    return null;
  }
  return {
    spans: spans.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]),
    cuts: [...cuts].toSorted((a, b) => a - b),
  };
}

/** True when Lottie frames a and b (a before b) of one scene show the same picture. */
export function sameFrame(activity: SceneActivity | null, a: number, b: number): boolean {
  if (!activity) {
    return false;
  }
  if (a === b) {
    return true;
  }
  return (
    !activity.spans.some(([start, end]) => b > start && a < end) &&
    !activity.cuts.some((cut) => a < cut && cut <= b)
  );
}

export interface HeldInput {
  film: Pick<TalkieFilm, 'duration' | 'scenes'>;
  /** Lottie JSON per scene, by scene index. Scenes the export never shows may be missing. */
  animations: unknown[];
  /** Film time of each output frame, rising. */
  times: number[];
  /** The caption burnt into each output frame; all '' when captions are not burnt in. */
  captions: string[];
}

/** For each output frame: true when it is the same picture as the frame before it. */
export function heldFrames({ film, animations, times, captions }: HeldInput): boolean[] {
  const activity = new Map<number, SceneActivity | null>();
  const at = (t: number) => {
    const pos = sceneAt(film as TalkieFilm, t);
    const a = animations[pos.index];
    const timed = isObject(a) && typeof a.fr === 'number' && typeof a.ip === 'number';
    if (!activity.has(pos.index)) {
      activity.set(pos.index, timed ? sceneActivity(a) : null);
    }
    const frame = timed
      ? frameFor(pos.localTime, a.fr as number, a.ip as number, a.op as number)
      : NaN;
    return { index: pos.index, frame };
  };
  let before: ReturnType<typeof at> | null = null;
  return times.map((t, i) => {
    const now = at(t);
    const held =
      before !== null &&
      before.index === now.index &&
      captions[i] === captions[i - 1] &&
      sameFrame(activity.get(now.index) ?? null, before.frame, now.frame);
    before = now;
    return held;
  });
}

// ---------------------------------------------------------------------------------------------
// The export

/** A `fetch` for `file:` URLs, so a film folder on disk opens the way one on a server does. */
const diskFetch = (async (input: Parameters<typeof fetch>[0]) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  try {
    return new Response(new Uint8Array(await readFile(fileURLToPath(url))));
  } catch {
    return new Response(null, { status: 404 });
  }
}) as typeof fetch;

interface DiskFilm {
  film: TalkieFilm;
  /** The film folder, or null for a packed film. */
  folder: string | null;
  /** The bytes of one file of the film. Rejects when it is missing. */
  read(path: string): Promise<Uint8Array>;
  close(): void;
}

async function openDisk(target: string): Promise<DiskFilm> {
  const path = resolve(target);
  const info = await stat(path).catch(() => null);
  if (!info) {
    throw new Error(`${target} does not exist`);
  }
  if (info.isDirectory()) {
    const { film, source } = await openFilm(pathToFileURL(`${path}/`), { fetch: diskFetch });
    return {
      film,
      folder: path,
      read: async (p) => {
        const file = safeJoin(path, p);
        if (!file) {
          throw new Error(`${p} is outside the film`);
        }
        return new Uint8Array(await readFile(file));
      },
      close: () => source.dispose(),
    };
  }
  const { film, source } = await openFilm(new Uint8Array(await readFile(path)));
  return {
    film,
    folder: null,
    read: async (p) => {
      const response = await fetch(await source.url(p));
      return new Uint8Array(await response.arrayBuffer());
    },
    close: () => source.dispose(),
  };
}

/** Pipe PNG frames into a low priority ffmpeg. `write` waits when ffmpeg falls behind. */
function startFfmpeg(args: string[]) {
  // runLow cannot take a stream on stdin, so this is the same nice and ionice prefix, spawned here
  const child = spawn('nice', ['-n', '19', 'ionice', '-c', '2', '-n', '7', 'ffmpeg', ...args], {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  // if ffmpeg dies early the exit code tells the story, not the broken pipe
  child.stdin.on('error', () => {});
  const exit = new Promise<void>((done, fail) => {
    child.on('error', fail);
    child.on('close', (code) =>
      code === 0 ? done() : fail(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`))
    );
  });
  exit.catch(() => {});
  let dead = false;
  void exit.then(
    () => {
      dead = true;
    },
    () => {
      dead = true;
    }
  );
  return {
    async write(png: Uint8Array): Promise<void> {
      if (dead) {
        await exit;
        throw new Error('ffmpeg stopped before the last frame');
      }
      if (!child.stdin.write(png)) {
        await Promise.race([new Promise((done) => child.stdin.once('drain', done)), exit]);
      }
    },
    async finish(): Promise<void> {
      child.stdin.end();
      await exit;
    },
    kill(): void {
      child.kill('SIGKILL');
    },
  };
}

export interface ExportEnv {
  /** The machine's name. Default: os.hostname(). */
  hostname?: string;
  /** The built player folder. Default: `@talkie/player/dist`, found from node_modules. */
  playerDir?: string;
  /** Where warnings and progress go. Default: stderr. */
  log?: (line: string) => void;
}

export interface ExportResult {
  out: string;
  plan: ExportPlan;
  /** Frames written to the video. */
  frames: number;
  /** How many of them reused the picture before, without drawing. */
  held: number;
}

interface RenderHooks {
  talkieExport?: {
    ready: Promise<string | null>;
    render(t: number, caption: string, fresh: boolean): Promise<void>;
  };
}

/**
 * Render a built film (folder or `.lottie`) to a video file: the player's engine draws each frame
 * in headless Chromium, ffmpeg encodes the screenshots and copies the narration in.
 */
export async function exportFilm(
  target: string,
  opts: ExportOptions,
  env: ExportEnv = {}
): Promise<ExportResult> {
  assertRenderBox(env.hostname ?? osHostname(), opts.allowHere === true);
  const log = env.log ?? ((line: string) => void process.stderr.write(`${line}\n`));

  // Chromium is a child of this process and takes its priority from it.
  const nice = getPriority();
  if (nice < 19) {
    log(
      `Warning: talkie export is running at nice ${nice}, not 19. Start it as: nice -n19 ionice -c2 -n7 talkie export ...`
    );
    try {
      setPriority(19);
    } catch {
      // the warning above stands
    }
  }

  const disk = await openDisk(target);
  const tmp = await mkdtemp(join(tmpdir(), 'talkie-export-'));
  const cleanup: Array<() => Promise<unknown> | void> = [
    () => disk.close(),
    () => rm(tmp, { recursive: true, force: true }),
  ];
  try {
    const { film } = disk;
    const plan = resolveExport(opts, film.duration);
    const playerDir = env.playerDir ?? findPlayerDist();
    if (!existsSync(join(playerDir, 'index.js'))) {
      throw new Error(`The player is not built: ${playerDir}/index.js was not found.`);
    }
    const dotLottieDir = findDotLottieDist(playerDir);

    let cues: ExportCue[] = [];
    if (plan.captions !== 'none') {
      const track = film.captions[0];
      if (!track) {
        throw new Error(`the film has no captions, so --captions ${plan.captions} cannot work`);
      }
      cues = parseCues(Buffer.from(await disk.read(track.src)).toString('utf8'));
    }

    const wanted = plan.audio === 'aac' ? ['audio/mp4'] : ['audio/webm', 'audio/ogg'];
    const narration = film.audio.find((a) => wanted.includes(a.type.split(';')[0]!.trim()));
    if (!narration) {
      throw new Error(
        `the film has no ${plan.audio === 'aac' ? 'AAC' : 'Opus'} narration to copy into the video`
      );
    }
    let audioFile: string;
    if (disk.folder) {
      audioFile = join(disk.folder, narration.src);
    } else {
      audioFile = join(tmp, `narration${extname(narration.src)}`);
      await writeFile(audioFile, await disk.read(narration.src));
    }
    let subtitles: string | null = null;
    if (plan.captions === 'track') {
      subtitles = join(tmp, 'captions.vtt');
      await writeFile(subtitles, shiftedVtt(cues, plan.from, plan.to));
    }

    const times = Array.from({ length: plan.frames }, (_, i) => plan.from + i / plan.fps);
    const captions = times.map((t) => (plan.captions === 'burn' ? captionAt(cues, t) : ''));
    const animations: unknown[] = [];
    for (const t of times) {
      const { index, scene } = sceneAt(film, t);
      if (animations[index] === undefined) {
        animations[index] = JSON.parse(Buffer.from(await disk.read(scene.src)).toString('utf8'));
      }
    }
    const held = heldFrames({ film, animations, times, captions });

    const svtav1 =
      plan.codec !== 'av1' ||
      (await runLow('ffmpeg', ['-hide_banner', '-encoders'])).stdout.includes('libsvtav1');

    // The render page and everything it loads, on a port only this machine can reach.
    const html = Buffer.from(renderPage());
    const handle = async (req: IncomingMessage, res: ServerResponse) => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path === '/') {
        sendBytes(req, res, html, contentType('page.html'));
      } else if (path.startsWith('/player/')) {
        await sendFile(req, res, playerDir, path.slice('/player/'.length));
      } else if (path.startsWith('/dotlottie/')) {
        await sendFile(req, res, dotLottieDir, path.slice('/dotlottie/'.length));
      } else if (path.startsWith('/film/')) {
        const name = decodeURIComponent(path.slice('/film/'.length));
        const bytes = await disk.read(name).catch(() => null);
        if (bytes) {
          sendBytes(req, res, bytes, contentType(name));
        } else {
          sendNotFound(res);
        }
      } else {
        sendNotFound(res);
      }
    };
    const server = createServer((req, res) => {
      handle(req, res).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    });
    await new Promise<void>((done, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', done);
    });
    cleanup.push(
      () =>
        new Promise<void>((done) => {
          server.close(() => done());
          server.closeAllConnections();
        })
    );
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

    const browser = await chromium.launch({ headless: true });
    cleanup.push(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: plan.size[0], height: plan.size[1] },
      deviceScaleFactor: 1,
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(origin);
    try {
      await page.waitForFunction(() => (window as RenderHooks).talkieExport !== undefined, null, {
        timeout: 30_000,
      });
    } catch {
      throw new Error(
        `the render page did not start${pageErrors.length > 0 ? `: ${pageErrors.join('; ')}` : ''}`
      );
    }
    const problem = await page.evaluate(() => (window as RenderHooks).talkieExport!.ready);
    if (problem !== null) {
      throw new Error(`the film could not be loaded for rendering: ${problem}`);
    }

    await mkdir(dirname(resolve(plan.out)), { recursive: true });
    const ffmpeg = startFfmpeg(ffmpegArgs(plan, { audio: audioFile, subtitles, svtav1 }));
    cleanup.push(() => ffmpeg.kill());
    let png: Uint8Array | null = null;
    let scene = -1;
    let reused = 0;
    for (let i = 0; i < times.length; i++) {
      const t = times[i]!;
      if (held[i] && png) {
        reused++;
      } else {
        const { index } = sceneAt(film, t);
        await page.evaluate(
          ([time, caption, fresh]) =>
            (window as RenderHooks).talkieExport!.render(time, caption, fresh),
          [t, captions[i]!, index !== scene] as const
        );
        scene = index;
        png = await page.screenshot({ type: 'png' });
      }
      await ffmpeg.write(png);
    }
    await ffmpeg.finish();
    return { out: plan.out, plan, frames: times.length, held: reused };
  } finally {
    for (const step of cleanup.toReversed()) {
      try {
        await step();
      } catch {
        // carry on cleaning up
      }
    }
  }
}
