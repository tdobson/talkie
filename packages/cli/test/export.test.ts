import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { buildFilm } from '../src/build';
import { exportCommand } from '../src/commands/export';
import {
  assertRenderBox,
  captionAt,
  exportFilm,
  ffmpegArgs,
  heldFrames,
  parseCues,
  parseSize,
  resolveExport,
  sameFrame,
  sceneActivity,
} from '../src/export/export';
import { renderPage } from '../src/export/render-page';
import { ALIAS, builtPlayer, voicedProject } from './helpers/project';

jest.setTimeout(300_000);

describe('arguments', () => {
  test('sizes by name and by width and height', () => {
    expect(parseSize('720p')).toEqual([1280, 720]);
    expect(parseSize('1080p')).toEqual([1920, 1080]);
    expect(parseSize('4k')).toEqual([3840, 2160]);
    expect(parseSize('320x180')).toEqual([320, 180]);
    expect(() => parseSize('big')).toThrow(
      'size must be 720p, 1080p, 4k or <W>x<H>, for example 1280x720'
    );
    expect(() => parseSize('321x180')).toThrow('size 321x180: width and height must be even');
  });

  test('defaults: h264, aac, 1080p, no captions, 25 fps, the whole film', () => {
    expect(resolveExport({ out: 'a.mp4' }, 18.967)).toEqual({
      out: 'a.mp4',
      container: 'mp4',
      codec: 'h264',
      audio: 'aac',
      size: [1920, 1080],
      from: 0,
      to: 18.967,
      captions: 'none',
      fps: 25,
      frames: 474,
    });
  });

  test('a WebM takes Opus by default; from and to cut the film', () => {
    const plan = resolveExport(
      { out: 'a.webm', codec: 'av1', size: '320x180', from: '2', to: '4.5', fps: '30' },
      18.967
    );
    expect(plan).toMatchObject({ container: 'webm', audio: 'opus', from: 2, to: 4.5, frames: 75 });
    expect(resolveExport({ out: 'a.mkv', to: '99' }, 10).to).toBe(10);
  });

  test('choices that cannot work are refused in plain words', () => {
    const bad = (opts: Parameters<typeof resolveExport>[0]) => () => resolveExport(opts, 10);
    expect(bad({ out: 'a.avi' })).toThrow('the output must end in .mp4, .mkv or .webm');
    expect(bad({ out: 'a.mp4', audio: 'opus' })).toThrow(
      'Opus audio needs an .mkv or .webm output'
    );
    expect(bad({ out: 'a.webm', codec: 'av1', audio: 'aac' })).toThrow(
      'a .webm output needs --audio opus'
    );
    expect(bad({ out: 'a.webm' })).toThrow('a .webm output needs --codec av1');
    expect(bad({ out: 'a.mp4', codec: 'vp9' })).toThrow('codec must be h264, h265 or av1');
    expect(bad({ out: 'a.mp4', audio: 'mp3' })).toThrow('audio must be aac or opus');
    expect(bad({ out: 'a.mp4', captions: 'yes' })).toThrow('captions must be burn, track or none');
    expect(bad({ out: 'a.mp4', from: '5', to: '5' })).toThrow('--to must be after --from');
    expect(bad({ out: 'a.mp4', from: '12' })).toThrow('--from is past the end of the film (10 s)');
    expect(bad({ out: 'a.mp4', fps: '0' })).toThrow('fps must be a number from 1 to 120');
  });

  test('ffmpeg arguments for each codec', () => {
    const plan = resolveExport({ out: 'a.mp4', size: '320x180', to: '2' }, 10);
    const base = { audio: 'n.m4a', subtitles: null, svtav1: true };
    expect(ffmpegArgs(plan, base)).toEqual([
      ...['-y', '-loglevel', 'error'],
      ...['-f', 'image2pipe', '-framerate', '25', '-c:v', 'png', '-i', '-'],
      ...['-ss', '0', '-t', '2', '-i', 'n.m4a'],
      ...['-map', '0:v:0', '-map', '1:a:0'],
      ...['-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-pix_fmt', 'yuv420p'],
      ...['-c:a', 'copy', '-t', '2', '-movflags', '+faststart', 'a.mp4'],
    ]);
    const h265 = ffmpegArgs({ ...plan, codec: 'h265' }, base).join(' ');
    expect(h265).toContain('-c:v libx265 -crf 26 -preset medium -tag:v hvc1 -pix_fmt yuv420p');
    const av1 = ffmpegArgs({ ...plan, codec: 'av1' }, base).join(' ');
    expect(av1).toContain('-c:v libsvtav1 -crf 35 -preset 8');
    const aom = ffmpegArgs({ ...plan, codec: 'av1' }, { ...base, svtav1: false }).join(' ');
    expect(aom).toContain('-c:v libaom-av1 -crf 35 -b:v 0 -cpu-used 6');
  });

  test('a captions track is mov_text in MP4 and WebVTT in MKV', () => {
    const mp4 = resolveExport({ out: 'a.mp4', captions: 'track' }, 10);
    const args = ffmpegArgs(mp4, { audio: 'n.m4a', subtitles: 'c.vtt', svtav1: true }).join(' ');
    expect(args).toContain('-i c.vtt -map 0:v:0 -map 1:a:0 -map 2:s:0');
    expect(args).toContain('-c:s mov_text');
    const mkv = resolveExport({ out: 'a.mkv', captions: 'track' }, 10);
    const mkvArgs = ffmpegArgs(mkv, { audio: 'n.webm', subtitles: 'c.vtt', svtav1: true });
    expect(mkvArgs.join(' ')).toContain('-c:s webvtt');
    expect(mkvArgs).not.toContain('-movflags');
  });

  test('the command takes every option the plan names', () => {
    expect(exportCommand.options.map((o) => o.long)).toEqual([
      '--out',
      '--codec',
      '--audio',
      '--size',
      '--from',
      '--to',
      '--captions',
      '--fps',
      '--allow-here',
    ]);
    expect(exportCommand.options[0]!.short).toBe('-o');
  });
});

describe('the tragicomix guard', () => {
  const message = 'Render on xebit-dev1, xebit-dev3 or asterix, not tragicomix';
  test('refuses on tragicomix', () => {
    expect(() => assertRenderBox('tragicomix', false)).toThrow(message);
    expect(() => assertRenderBox('tragicomix.lan', false)).toThrow(message);
  });
  test('lets --allow-here through, and any other host', () => {
    expect(() => assertRenderBox('tragicomix', true)).not.toThrow();
    expect(() => assertRenderBox('asterix', false)).not.toThrow();
  });
  test('exportFilm checks the host before it does anything else', async () => {
    await expect(
      exportFilm('/nowhere', { out: '/nowhere/a.mp4' }, { hostname: 'tragicomix' })
    ).rejects.toThrow(message);
  });
});

describe('captions', () => {
  const vtt =
    'WEBVTT\n\n00:00:01.400 --> 00:00:02.000\nThis is a\n\n00:00:02.000 --> 00:00:04.567\nroof &amp; <i>tile</i>.\n';
  test('cues are read from WebVTT', () => {
    expect(parseCues(vtt)).toEqual([
      { start: 1.4, end: 2, text: 'This is a' },
      { start: 2, end: 4.567, text: 'roof & tile.' },
    ]);
  });
  test('the caption on screen at a time', () => {
    const cues = parseCues(vtt);
    expect(captionAt(cues, 1)).toBe('');
    expect(captionAt(cues, 1.4)).toBe('This is a');
    expect(captionAt(cues, 2)).toBe('roof & tile.');
    expect(captionAt(cues, 5)).toBe('');
  });
});

describe('held frames', () => {
  const moving = {
    a: 1,
    k: [
      { t: 10, s: [0] },
      { t: 20, s: [100] },
      { t: 30, s: [100] },
    ],
  };
  const animation = {
    fr: 25,
    ip: 0,
    op: 100,
    layers: [{ ip: 0, op: 100, ks: { o: moving, p: { a: 0, k: [1, 2] } } }],
  };
  test('a scene changes only while a keyframe segment changes value', () => {
    expect(sceneActivity(animation)).toEqual({ spans: [[10, 20]], cuts: [] });
  });
  test('a layer that comes in or goes out part way is a cut', () => {
    const late = { ...animation, layers: [{ ip: 40, op: 60, ks: {} }] };
    expect(sceneActivity(late)).toEqual({ spans: [], cuts: [40, 60] });
  });
  test('a hold keyframe is a cut; an eased return to the same value is not trusted', () => {
    const hold = {
      a: 1,
      k: [
        { t: 5, s: [0], h: 1 },
        { t: 9, s: [1] },
      ],
    };
    expect(sceneActivity({ layers: [{ ks: { o: hold } }] })).toEqual({ spans: [], cuts: [9] });
    const loop = {
      a: 1,
      k: [
        { t: 5, s: [0, 0], to: [9, 9], ti: [1, 1] },
        { t: 9, s: [0, 0] },
      ],
    };
    expect(sceneActivity({ layers: [{ ks: { p: loop } }] })).toEqual({ spans: [[5, 9]], cuts: [] });
  });
  test('expressions and precomps make the whole scene count as moving', () => {
    expect(sceneActivity({ layers: [{ ks: { o: { a: 0, k: 1, x: 'time' } } }] })).toBeNull();
    expect(sceneActivity({ assets: [{ layers: [] }], layers: [] })).toBeNull();
  });
  test('two frames match when nothing moves from one to the other', () => {
    const activity = sceneActivity(animation);
    expect(sameFrame(activity, 2, 3)).toBe(true);
    expect(sameFrame(activity, 9, 10)).toBe(true);
    expect(sameFrame(activity, 10, 11)).toBe(false);
    expect(sameFrame(activity, 19, 20)).toBe(false);
    expect(sameFrame(activity, 20, 21)).toBe(true);
    expect(sameFrame(null, 2, 3)).toBe(false);
    expect(sameFrame({ spans: [], cuts: [40] }, 39, 39.5)).toBe(true);
    expect(sameFrame({ spans: [], cuts: [40] }, 39.5, 40)).toBe(false);
  });
  test('a frame is held when scene, picture and burnt caption all match the one before', () => {
    const film = {
      duration: 8,
      scenes: [
        { id: 'a', src: 'a/a.json', start: 0, end: 4 },
        { id: 'b', src: 'a/b.json', start: 4, end: 8 },
      ],
    };
    const still = { fr: 25, ip: 0, op: 100, layers: [] };
    const held = heldFrames({
      film,
      animations: [animation, still],
      times: [0, 0.2, 0.4, 0.6, 3.8, 4, 4.2],
      captions: ['', '', '', '', '', '', 'Hello'],
    });
    // 0.4 s is frame 10, the start of the fade; 0.6 s is inside it; 4 s is a new scene
    expect(held).toEqual([false, true, true, false, false, false, false]);
  });
});

test('the render page loads the engine from the built player and names its hooks', () => {
  const html = renderPage();
  expect(html).toContain('"@lottiefiles/dotlottie-web": "/dotlottie/index.js"');
  expect(html).toContain("from '/player/index.js'");
  expect(html).toContain("setWasmUrl('/dotlottie/dotlottie-player.wasm')");
  expect(html).toContain('window.talkieExport');
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();
const describeRender = hasFfmpeg && hasChromium ? describe : describe.skip;

describeRender('needs ffmpeg and chromium (skipped when either is missing)', () => {
  let dir = '';
  let playerDir = '';
  beforeAll(async () => {
    dir = await voicedProject();
    playerDir = await builtPlayer();
    await buildFilm(dir, { alias: ALIAS });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(playerDir, { recursive: true, force: true });
  });

  const probe = (file: string) => {
    const run = spawnSync(
      'ffprobe',
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
      { encoding: 'utf8' }
    );
    return JSON.parse(run.stdout) as {
      streams: Array<Record<string, string | number>>;
      format: { duration: string };
    };
  };

  test.each([
    ['h264', 'avc1', 'film folder', 'dist/film'],
    ['h265', 'hvc1', '.lottie', 'dist/film.lottie'],
  ])('%s export is tagged %s, from a %s', async (codec, tag, _form, target) => {
    const out = join(dir, `${codec}.mp4`);
    const done = await exportFilm(
      join(dir, target),
      { out, codec, size: '320x180', from: '1', to: '3', captions: 'burn', allowHere: true },
      { playerDir }
    );
    expect(done).toMatchObject({ out, frames: 50 });
    // the fade of one-a starts at 1.4 s, so the frames before it are held
    expect(done.held).toBeGreaterThan(5);
    expect(done.held).toBeLessThan(50);

    const info = probe(out);
    const video = info.streams.find((s) => s.codec_type === 'video')!;
    const audio = info.streams.find((s) => s.codec_type === 'audio')!;
    expect(video.codec_tag_string).toBe(tag);
    expect([video.width, video.height]).toEqual([320, 180]);
    expect(video.pix_fmt).toBe('yuv420p');
    expect(audio.codec_name).toBe('aac');
    expect(Math.abs(Number(info.format.duration) - 2)).toBeLessThan(0.1);
  });

  test('the picture is the film, not a blank page', () => {
    const out = join(dir, 'h264.mp4');
    const frame = spawnSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-ss',
        '1.9',
        '-i',
        out,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        '-',
      ],
      { maxBuffer: 1 << 24 }
    ).stdout;
    expect(frame.length).toBe(320 * 180);
    expect(new Set(frame).size).toBeGreaterThan(8);
  });

  test('a captions track goes into an MKV with Opus audio', async () => {
    const out = join(dir, 'track.mkv');
    await exportFilm(
      join(dir, 'dist/film'),
      { out, size: '320x180', to: '2', captions: 'track', audio: 'opus', allowHere: true },
      { playerDir }
    );
    const info = probe(out);
    expect(info.streams.map((s) => s.codec_type)).toEqual(['video', 'audio', 'subtitle']);
    expect(info.streams[1]!.codec_name).toBe('opus');
    expect(info.streams[2]!.codec_name).toBe('webvtt');
  });
});
