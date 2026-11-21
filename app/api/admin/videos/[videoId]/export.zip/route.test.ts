import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { resetConfigForTests } from '@/lib/config';
import { SEED, seedExport, seedRef, setSeedStatus, VIDEO_ID } from '@/test/fixtures/export-seed';
import { withTmpData } from '@/test/helpers/tmpData';
import { GET as GET_JSON } from '../export.json/route';
import { GET } from './route';

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await withTmpData());
  process.env.ADMIN_AUTH = 'off';
  resetConfigForTests();
  await seedExport();
});

afterEach(async () => {
  delete process.env.ADMIN_AUTH;
  resetConfigForTests();
  await cleanup();
});

const call = (
  handler: typeof GET,
  file: string,
  videoId: string,
  query = '',
  headers: Record<string, string> = {}
) =>
  handler(
    new Request(`http://localhost/api/admin/videos/${videoId}/${file}${query}`, { headers }),
    {
      params: Promise.resolve({ videoId }),
    }
  );
const zip = (query = '', headers: Record<string, string> = {}, videoId = VIDEO_ID) =>
  call(GET, 'export.zip', videoId, query, headers);
const json = (query = '', headers: Record<string, string> = {}, videoId = VIDEO_ID) =>
  call(GET_JSON, 'export.json', videoId, query, headers);

async function entryNames(res: Response): Promise<string[]> {
  const path = join(dir, 'download.zip');
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, file) => {
      if (err || !file) return reject(err);
      const names: string[] = [];
      file.on('entry', (entry: yauzl.Entry) => {
        names.push(entry.fileName);
        file.readEntry();
      });
      file.on('end', () => resolve(names));
      file.on('error', reject);
      file.readEntry();
    });
  });
}

describe('export.zip', () => {
  it('export route returns 401 without admin and a zip with it', async () => {
    process.env.ADMIN_AUTH = 'cloudflare';
    resetConfigForTests();
    expect((await zip()).status).toBe(401);
    expect((await json()).status).toBe(401);

    process.env.ADMIN_AUTH = 'off';
    resetConfigForTests();
    const res = await zip();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="launch-film-ab12-v2-\d{8}-\d{4}\.zip"$/
    );
    expect(res.headers.get('ETag')).toMatch(/^"[0-9a-f]{64}"$/);
    const names = await entryNames(res);
    expect(names).toEqual(
      expect.arrayContaining([
        'README.md',
        'feedback.md',
        'feedback.json',
        `media/${SEED.devMoment}/overview.jpg`,
        'previous/v1/feedback.md',
      ])
    );
  });

  it('answers 304 when the ETag still matches', async () => {
    const etag = (await zip()).headers.get('ETag') ?? '';
    const again = await zip('', { 'If-None-Match': etag });
    expect(again.status).toBe(304);
    expect(again.headers.get('ETag')).toBe(etag);
    expect(await again.text()).toBe('');
    expect((await zip('', { 'If-None-Match': `"other", W/${etag}` })).status).toBe(304);

    await setSeedStatus(seedRef(SEED.dev, SEED.devMoment), {
      updatedAt: '2026-11-21T12:00:00.000Z',
    });
    expect((await zip('', { 'If-None-Match': etag })).status).toBe(200);
    // Other options give another bundle, so another ETag.
    expect((await zip('?version=1', { 'If-None-Match': etag })).status).toBe(200);
  });

  it('answers 202 with Retry-After while comments are processing, unless partial', async () => {
    await setSeedStatus(seedRef(SEED.dev, SEED.devScrolled), { state: 'processing' });
    const res = await zip();
    expect(res.status).toBe(202);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(await res.json()).toEqual({ pending: 1 });
    expect((await zip('?partial=1')).status).toBe(200);
  });

  it('waits for clips only with clips=1', async () => {
    expect((await zip()).status).toBe(200);
    expect((await zip('?clips=1')).status).toBe(202);
  });

  it('exports another version when asked', async () => {
    const res = await zip('?version=1');
    expect(res.headers.get('Content-Disposition')).toContain('launch-film-ab12-v1-');
    const names = await entryNames(res);
    expect(names).toContain(`media/${SEED.previous}/overview.jpg`);
    expect(names.some((n) => n.startsWith('previous/'))).toBe(false);
  });

  it('404s for an unknown video or version and 400s for a bad query', async () => {
    expect((await zip('', {}, 'no-such-video')).status).toBe(404);
    expect((await zip('', {}, '..')).status).toBe(404);
    expect((await zip('?version=9')).status).toBe(404);
    expect((await zip('?version=newest')).status).toBe(400);
    expect((await zip('?since=yesterday')).status).toBe(400);
  });
});

describe('export.json', () => {
  it('returns the model', async () => {
    const res = await json();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = await res.json();
    expect(body.schemaVersion).toBe(1);
    expect(body.video).toMatchObject({ videoId: VIDEO_ID, version: 2 });
    expect(body.comments).toHaveLength(6);
    expect(body.previous[0].version).toBe(1);
  });

  it('takes the same query, 202 and 304 rules as the zip', async () => {
    expect((await (await json('?version=all')).json()).comments).toHaveLength(7);
    expect((await json('?version=9')).status).toBe(404);
    expect((await json('?version=x')).status).toBe(400);
    const etag = (await json()).headers.get('ETag') ?? '';
    expect((await json('', { 'If-None-Match': etag })).status).toBe(304);

    await setSeedStatus(seedRef(SEED.dev, SEED.devScrolled), { state: 'queued' });
    const waiting = await json();
    expect(waiting.status).toBe(202);
    expect(waiting.headers.get('Retry-After')).toBe('30');
  });
});
