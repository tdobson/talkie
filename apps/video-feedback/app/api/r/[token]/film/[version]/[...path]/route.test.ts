import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { GET as getVideoRoute } from '@/app/api/r/[token]/video/route';
import { filmDir, sourcePath, versionDir } from '@/lib/storage/paths';
import { createVideo, saveVideo } from '@/lib/storage/repo';
import type { VideoRecord } from '@/lib/types';
import { TALKIE_MINI_DIR } from '@/test/helpers/talkieFixture';
import { withTmpData } from '@/test/helpers/tmpData';
import { GET } from './route';

let cleanup: () => Promise<void>;
let video: VideoRecord;

// Version 1 is an MP4, version 2 a Talkie film.
beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  const v = await createVideo('Launch film');
  video = {
    ...v,
    latestVersion: 2,
    versions: [
      { version: 1, importedAt: 'now', originalFilename: 'a.mp4' },
      { version: 2, importedAt: 'now', originalFilename: 'a.lottie', mediaKind: 'talkie' },
    ],
  };
  await saveVideo(video);
  await mkdir(dirname(sourcePath(video.videoId, 1)), { recursive: true });
  await writeFile(sourcePath(video.videoId, 1), 'mp4 bytes');
  await cp(TALKIE_MINI_DIR, filmDir(video.videoId, 2), { recursive: true });
  await writeFile(join(versionDir(video.videoId, 2), 'probe.json'), '{"secret":true}');
});
afterEach(() => cleanup());

interface Opts {
  version?: string;
  range?: string;
  token?: string;
  acceptEncoding?: string;
}

/** Calls the route the way Next does: the catch-all arrives as decoded path segments. */
function get(path: string | string[], opts: Opts = {}): Promise<Response> {
  const { version = '2', range, token = video.token, acceptEncoding } = opts;
  const segments = typeof path === 'string' ? path.split('/') : path;
  const url = `http://localhost/api/r/${token}/film/${encodeURIComponent(version)}/${segments.map(encodeURIComponent).join('/')}`;
  const headers: Record<string, string> = {};
  if (range) headers.Range = range;
  if (acceptEncoding) headers['Accept-Encoding'] = acceptEncoding;
  const req = new Request(url, { headers });
  return GET(req, { params: Promise.resolve({ token, version, path: segments }) });
}

const fixture = (path: string) => readFile(join(TALKIE_MINI_DIR, path));
const body = async (res: Response) => Buffer.from(await res.arrayBuffer());

it('serves talkie.json', async () => {
  const res = await get('talkie.json');
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toBe('application/json');
  expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect((await body(res)).equals(await fixture('talkie.json'))).toBe(true);
});

it('serves a scene, a caption and the poster with their types', async () => {
  for (const [path, type] of [
    ['a/s01.json', 'application/json'],
    ['captions/en.vtt', 'text/vtt'],
    ['poster.png', 'image/png'],
  ]) {
    const res = await get(path);
    expect(res.status, path).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(type);
    expect((await body(res)).equals(await fixture(path)), path).toBe(true);
  }
});

describe('a scene stored gzipped', () => {
  // Since the gzip change a film's scenes are kept as <path>.gz; the plain file is gone.
  beforeEach(async () => {
    const plain = join(filmDir(video.videoId, 2), 'a', 's01.json');
    await writeFile(`${plain}.gz`, gzipSync(await readFile(plain)));
    await rm(plain);
  });

  it('is sent unzipped, whatever the client takes (Next drops a route Content-Encoding)', async () => {
    for (const acceptEncoding of [undefined, 'gzip, deflate, br', 'identity']) {
      const res = await get('a/s01.json', { acceptEncoding });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/json');
      expect(res.headers.get('Content-Encoding')).toBeNull();
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect((await body(res)).equals(await fixture('a/s01.json'))).toBe(true);
    }
  });

  it('cannot be fetched by its stored name', async () => {
    expect((await get('a/s01.json.gz', { acceptEncoding: 'gzip' })).status).toBe(404);
  });
});

it('serves the audio with Range as 206', async () => {
  const whole = await fixture('u/narration.m4a');
  const res = await get('u/narration.m4a', { range: 'bytes=10-109' });
  expect(res.status).toBe(206);
  expect(res.headers.get('Content-Type')).toBe('audio/mp4');
  expect(res.headers.get('Accept-Ranges')).toBe('bytes');
  expect(res.headers.get('Content-Range')).toBe(`bytes 10-109/${whole.byteLength}`);
  expect(res.headers.get('Content-Length')).toBe('100');
  expect((await body(res)).equals(whole.subarray(10, 110))).toBe(true);

  const tail = await get('u/narration.opus', { range: 'bytes=-5' });
  expect(tail.status).toBe(206);
  expect((await body(tail)).equals((await fixture('u/narration.opus')).subarray(-5))).toBe(true);
});

it('serves the whole audio file with 200 when no range is asked for, and 416s past the end', async () => {
  const whole = await fixture('u/narration.m4a');
  const res = await get('u/narration.m4a');
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Length')).toBe(String(whole.byteLength));
  expect(res.headers.get('Content-Range')).toBeNull();
  const past = await get('u/narration.m4a', { range: 'bytes=99999999-' });
  expect(past.status).toBe(416);
  expect(past.headers.get('Content-Range')).toBe(`bytes */${whole.byteLength}`);
});

it('404s for a file that is in film/ but not listed in talkie.json', async () => {
  // manifest.json is in the fixture folder, and extra.json is added here; neither is listed.
  await writeFile(join(filmDir(video.videoId, 2), 'a', 'extra.json'), '{}');
  expect((await get('manifest.json')).status).toBe(404);
  expect((await get('a/extra.json')).status).toBe(404);
  expect((await get('a')).status).toBe(404);
});

it.each([
  [['..', 'probe.json']],
  [['a', '..', '..', 'probe.json']],
  [['..%2Fprobe.json']],
  [['%2e%2e', 'probe.json']],
  [['%2e%2e%2fprobe.json']],
  [['../probe.json']],
  [['a', '..', 'talkie.json']],
  [['a/../talkie.json']],
  [['.', 'talkie.json']],
  [['', 'talkie.json']],
  [['talkie.json', '']],
  [['a\\s01.json']],
  [['/etc/passwd']],
  [['talkie.json\0']],
  [[]],
])('404s for traversal, plain or encoded: %j', async (segments) => {
  const res = await get(segments);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not found' });
});

it('404s for a listed path that is a symlink out of the film', async () => {
  const target = join(filmDir(video.videoId, 2), 'captions', 'en.vtt');
  await rm(target);
  await symlink(join(versionDir(video.videoId, 2), 'probe.json'), target);
  expect((await get('captions/en.vtt')).status).toBe(404);
});

it('404s for an mp4 version', async () => {
  // Even with a film folder sitting there, the recorded kind decides.
  await cp(TALKIE_MINI_DIR, filmDir(video.videoId, 1), { recursive: true });
  expect((await get('talkie.json', { version: '1' })).status).toBe(404);
});

it('has the video route 404 for a talkie version', async () => {
  // Even with a source.mp4 sitting there, the recorded kind decides.
  await writeFile(sourcePath(video.videoId, 2), 'mp4 bytes');
  const call = (version: number) =>
    getVideoRoute(new Request(`http://localhost/api/r/${video.token}/video?version=${version}`), {
      params: Promise.resolve({ token: video.token }),
    });
  expect((await call(2)).status).toBe(404);
  expect((await call(1)).status).toBe(200);
});

describe('token and version checks, as on the video route', () => {
  it('404s for a wrong token', async () => {
    const res = await get('talkie.json', { token: 'nope' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });

  it.each(['3', '0', 'abc', '1.5', '2x', ''])(
    '404s for a version that is not on the video: "%s"',
    async (version) => {
      expect((await get('talkie.json', { version })).status).toBe(404);
    }
  );

  it('404s when the film folder is gone or its talkie.json is unreadable', async () => {
    await writeFile(join(filmDir(video.videoId, 2), 'talkie.json'), '{nope');
    expect((await get('a/s01.json')).status).toBe(404);
    expect((await get('talkie.json')).status).toBe(404);
  });
});

it('carries the private cache header on a ranged audio response', async () => {
  const res = await get('u/narration.m4a', { range: 'bytes=0-9' });
  expect(res.status).toBe(206);
  expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
});

it.each(['3', '0', 'abc', '2.5', '-1'])(
  '404s for version %s, which the video does not have',
  async (version) => {
    const res = await get('talkie.json', { version });
    expect(res.status).toBe(404);
  }
);
