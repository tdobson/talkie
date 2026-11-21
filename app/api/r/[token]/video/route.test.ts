import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sourcePath } from '@/lib/storage/paths';
import { createVideo, saveVideo } from '@/lib/storage/repo';
import type { VideoRecord } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { GET } from './route';

const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));

let cleanup: () => Promise<void>;
let video: VideoRecord;

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  const v = await createVideo('Launch film');
  video = {
    ...v,
    latestVersion: 2,
    versions: [1, 2].map((version) => ({ version, importedAt: 'now', originalFilename: 'a.mp4' })),
  };
  await saveVideo(video);
  await mkdir(dirname(sourcePath(video.videoId, 2)), { recursive: true });
  await writeFile(sourcePath(video.videoId, 2), bytes);
});
afterEach(() => cleanup());

function get(query: string, range?: string, token = video.token): Promise<Response> {
  const req = new Request(`http://localhost/api/r/${token}/video${query}`, {
    headers: range ? { Range: range } : {},
  });
  return GET(req, { params: Promise.resolve({ token }) });
}

async function body(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

it('serves a byte range with 206 and Content-Range', async () => {
  const res = await get('?version=2', 'bytes=0-99');
  expect(res.status).toBe(206);
  expect(res.headers.get('Content-Range')).toBe('bytes 0-99/1000');
  expect(res.headers.get('Content-Length')).toBe('100');
  expect(res.headers.get('Accept-Ranges')).toBe('bytes');
  expect(res.headers.get('Content-Type')).toBe('video/mp4');
  expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
  expect((await body(res)).equals(bytes.subarray(0, 100))).toBe(true);
});

it('serves an open-ended and a suffix range', async () => {
  const tail = await get('?version=2', 'bytes=900-');
  expect(tail.status).toBe(206);
  expect(tail.headers.get('Content-Range')).toBe('bytes 900-999/1000');
  expect((await body(tail)).equals(bytes.subarray(900))).toBe(true);
  const suffix = await get('?version=2', 'bytes=-10');
  expect(suffix.headers.get('Content-Range')).toBe('bytes 990-999/1000');
  expect((await body(suffix)).equals(bytes.subarray(990))).toBe(true);
});

it('serves the whole file with 200 when no range is asked for', async () => {
  const res = await get('?version=2');
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Length')).toBe('1000');
  expect(res.headers.get('Accept-Ranges')).toBe('bytes');
  expect(res.headers.get('Content-Type')).toBe('video/mp4');
  expect(res.headers.get('Content-Range')).toBeNull();
  expect((await body(res)).equals(bytes)).toBe(true);
});

it('416s for a range past the end', async () => {
  const res = await get('?version=2', 'bytes=2000-');
  expect(res.status).toBe(416);
  expect(res.headers.get('Content-Range')).toBe('bytes */1000');
});

it('404s for a wrong token', async () => {
  const res = await get('?version=2', undefined, 'nope');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not found' });
});

it.each(['?version=3', '?version=0', '?version=abc', '?version=1.5', '?version=2x', ''])(
  '404s for a version that is not on the video: "%s"',
  async (query) => {
    expect((await get(query)).status).toBe(404);
  }
);

it('404s when the version exists but its file is gone', async () => {
  expect((await get('?version=1')).status).toBe(404);
});
