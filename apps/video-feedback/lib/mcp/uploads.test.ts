import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { limits } from '@/lib/limits';
import { fx } from '@/lib/media/testutil';
import { inboxDir } from '@/lib/storage/paths';
import { getVideo } from '@/lib/storage/repo';
import { TALKIE_MINI_LOTTIE } from '@/test/helpers/talkieFixture';
import { withTmpData } from '@/test/helpers/tmpData';
import {
  createUpload,
  getUpload,
  handleFinish,
  handlePart,
  handlePartSize,
  openUpload,
  readUpload,
  setUploadDiskProbeForTests,
  type UploadRecord,
  uploadLimits,
  uploadsDir,
} from './uploads';

const saved = { ...uploadLimits };
let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await withTmpData());
  setUploadDiskProbeForTests(async () => Number.MAX_SAFE_INTEGER);
});
afterEach(async () => {
  Object.assign(uploadLimits, saved);
  setUploadDiskProbeForTests(null);
  await cleanup();
});

const newFilm = (filename = 'film.mp4', title = 'Launch film') =>
  createUpload({ filename, mode: 'new', title, createdBy: 'tim@example.com' });

const put = (token: string, n: string | number, body: Uint8Array | null) =>
  handlePart(
    token,
    String(n),
    new Request(`http://x/api/upload/${token}/part/${n}`, {
      method: 'PUT',
      body: body as BodyInit | null,
    })
  );

/** Sends a file in parts of `size` bytes, as the command does. */
async function sendAll(token: string, bytes: Buffer, size: number): Promise<void> {
  for (let i = 0; i * size < bytes.length; i++) {
    const res = await put(token, i, bytes.subarray(i * size, (i + 1) * size));
    expect(res.status).toBe(200);
  }
}

describe('upload records', () => {
  it('makes a record with only a hash of the secret, and opens it with the token', async () => {
    const { record, token } = await newFilm();
    expect(record.uploadId).toMatch(/^[a-z0-9]{16}$/);
    const [id, secret] = token.split('.');
    expect(id).toBe(record.uploadId);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const onDisk = await readFile(join(uploadsDir(), id, 'upload.json'), 'utf8');
    expect(onDisk).not.toContain(secret);
    expect(JSON.parse(onDisk)).toMatchObject({
      state: 'waiting',
      receivedBytes: 0,
      mode: 'new',
      title: 'Launch film',
      createdBy: 'tim@example.com',
    });
    expect(Date.parse(record.expiresAt) - Date.parse(record.createdAt)).toBe(2 * 3_600_000);
    expect(await openUpload(token)).toMatchObject({ status: 'ok' });
  });

  it('treats a wrong secret, an unknown id and nonsense the same', async () => {
    const { record, token } = await newFilm();
    const other = `${record.uploadId}.${'A'.repeat(43)}`;
    expect(await openUpload(other)).toEqual({ status: 'not-found' });
    expect(await openUpload(`zzzzzzzzzzzzzzzz.${token.split('.')[1]}`)).toEqual({
      status: 'not-found',
    });
    expect(await openUpload('../../etc/passwd')).toEqual({ status: 'not-found' });
    expect(await openUpload(record.uploadId)).toEqual({ status: 'not-found' });
  });

  it('expires after two hours', async () => {
    const now = Date.now();
    const { token } = await createUpload(
      { filename: 'film.mp4', mode: 'new', title: 'x', createdBy: null },
      now
    );
    expect((await openUpload(token, now + 2 * 3_600_000 - 1)).status).toBe('ok');
    expect((await openUpload(token, now + 2 * 3_600_000 + 1)).status).toBe('expired');
  });

  it('each part moves the expiry to 2 hours from then, but never past 24 hours from the start', async () => {
    const hourAgo = Date.now() - 3_600_000;
    const { record, token } = await createUpload(
      { filename: 'film.mp4', mode: 'new', title: 'x', createdBy: null },
      hourAgo
    );
    expect(Date.parse(record.expiresAt)).toBe(hourAgo + 2 * 3_600_000);
    const before = Date.now();
    expect((await put(token, 0, Buffer.alloc(10))).status).toBe(200);
    const slid = Date.parse((await getUpload(record.uploadId))?.expiresAt ?? '');
    expect(slid).toBeGreaterThanOrEqual(before + 2 * 3_600_000);
    expect(slid).toBeLessThanOrEqual(Date.now() + 2 * 3_600_000);

    // The last day is the limit, however much keeps arriving.
    uploadLimits.maxLifetimeMs = 90 * 60_000;
    expect((await put(token, 1, Buffer.alloc(10))).status).toBe(200);
    expect((await getUpload(record.uploadId))?.expiresAt).toBe(
      new Date(hourAgo + 90 * 60_000).toISOString()
    );
  });

  it('sweeps upload folders older than a day when a new upload is made', async () => {
    const old = await newFilm();
    const recent = await newFilm();
    const oldDir = join(uploadsDir(), old.record.uploadId);
    const dayAgo = new Date(Date.now() - 25 * 3_600_000);
    await utimes(oldDir, dayAgo, dayAgo);
    await newFilm();
    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(join(uploadsDir(), recent.record.uploadId))).toBe(true);
  });

  it('the sweep keeps the parts of a recently expired upload, and drops half-joined films', async () => {
    uploadLimits.ttlMs = 50;
    const { record, token } = await newFilm();
    expect((await put(token, 0, Buffer.alloc(10))).status).toBe(200);
    await mkdir(inboxDir(), { recursive: true });
    const half = join(inboxDir(), `.upload-${record.uploadId}.tmp`);
    await writeFile(half, 'half');
    const dayAgo = new Date(Date.now() - 25 * 3_600_000);
    await utimes(half, dayAgo, dayAgo);
    await new Promise((r) => setTimeout(r, 80));
    await newFilm();
    expect(await readdir(join(uploadsDir(), record.uploadId, 'parts'))).toEqual(['0']);
    expect(await getUpload(record.uploadId)).toMatchObject({ state: 'receiving' });
    expect(existsSync(half)).toBe(false);
  });

  const stuckFor = async (record: UploadRecord, minutes: number, inboxFile?: string) => {
    const stuck: UploadRecord = {
      ...record,
      state: 'importing',
      importStartedAt: new Date(Date.now() - minutes * 60_000).toISOString(),
      ...(inboxFile ? { inboxFile } : {}),
    };
    await writeFile(join(uploadsDir(), record.uploadId, 'upload.json'), JSON.stringify(stuck));
  };

  it('marks an import cut off by a restart as failed after 15 minutes, naming the file', async () => {
    const { record } = await newFilm();
    await stuckFor(record, 14, 'film-2.mp4');
    expect((await readUpload(record.uploadId))?.state).toBe('importing');
    await stuckFor(record, 16, 'film-2.mp4');
    const read = await readUpload(record.uploadId);
    expect(read).toMatchObject({ state: 'failed', error: expect.stringMatching(/cut off/) });
    expect(read?.error).toContain(
      'call import_from_inbox with filename "film-2.mp4", mode "new" and title "Launch film"'
    );
    expect((await getUpload(record.uploadId))?.state).toBe('failed');
  });

  it('opens an upload again when the restart came while the parts were being joined', async () => {
    const { record, token } = await newFilm();
    const film = await readFile(fx('h264.mp4'));
    await sendAll(token, film, 100_000);
    const { expiresAt: _e, ...rest } = (await getUpload(record.uploadId)) as UploadRecord;
    await stuckFor({ ...rest, expiresAt: new Date(0).toISOString() }, 16);
    const read = await readUpload(record.uploadId);
    expect(read).toMatchObject({
      state: 'receiving',
      error: expect.stringMatching(/Run the same command again/),
    });
    // Usable again: the link was given more time, and the parts are all still there.
    expect(Date.parse(read?.expiresAt ?? '')).toBeGreaterThan(Date.now());
    expect((await handleFinish(token, String(film.length))).status).toBe(200);
  });

  it('never calls an import stale while this server is still running it', async () => {
    uploadLimits.finishWaitMs = 0;
    uploadLimits.staleImportMs = 0;
    const { record, token } = await newFilm();
    const film = await readFile(fx('h264.mp4'));
    await sendAll(token, film, 1 << 20);
    expect((await handleFinish(token, String(film.length))).status).toBe(202);
    expect((await readUpload(record.uploadId, Date.now() + 3_600_000))?.state).toBe('importing');
    for (let i = 0; i < 300 && (await getUpload(record.uploadId))?.state !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect((await readUpload(record.uploadId))?.state).toBe('done');
  });
});

describe('PUT part', () => {
  it('stores parts, counts the bytes, and a part sent again replaces the first', async () => {
    const { record, token } = await newFilm();
    const res = await put(token, 0, Buffer.alloc(1000, 1));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok 1000\n');
    expect(await getUpload(record.uploadId)).toMatchObject({
      state: 'receiving',
      receivedBytes: 1000,
    });
    expect((await put(token, 1, Buffer.alloc(500, 2))).status).toBe(200);
    expect((await put(token, 0, Buffer.alloc(700, 3))).status).toBe(200);
    expect((await getUpload(record.uploadId))?.receivedBytes).toBe(1200);
    const parts = join(uploadsDir(), record.uploadId, 'parts');
    expect((await readdir(parts)).sort()).toEqual(['0', '1']);
    expect(await readFile(join(parts, '0'))).toEqual(Buffer.alloc(700, 3));
  });

  it('answers 404 for a wrong token and says nothing more', async () => {
    const { record } = await newFilm();
    const res = await put(`${record.uploadId}.${'B'.repeat(43)}`, 0, Buffer.from('x'));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('not found\n');
    const unknown = await put(`aaaaaaaaaaaaaaaa.${'B'.repeat(43)}`, 0, Buffer.from('x'));
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe('not found\n');
  });

  it('answers 410 once the link has expired, and keeps the parts for the daily sweep', async () => {
    uploadLimits.ttlMs = 50;
    const { record, token } = await newFilm();
    expect((await put(token, 0, Buffer.from('x'))).status).toBe(200);
    await new Promise((r) => setTimeout(r, 80));
    const res = await put(token, 1, Buffer.from('x'));
    expect(res.status).toBe(410);
    expect(await res.text()).toMatch(/upload_film again/);
    expect((await handleFinish(token, '1')).status).toBe(410);
    expect(await readdir(join(uploadsDir(), record.uploadId, 'parts'))).toEqual(['0']);
  });

  /** A part whose body arrives only when `release` is called. */
  function slowPart(token: string, n: number, first: Uint8Array) {
    let release: (rest?: Uint8Array) => void = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(first);
        release = (rest) => {
          if (rest) c.enqueue(rest);
          c.close();
        };
      },
    });
    const res = handlePart(
      token,
      String(n),
      new Request('http://x/', { method: 'PUT', body, duplex: 'half' } as RequestInit)
    );
    return { res, release: (rest?: Uint8Array) => release(rest) };
  }

  const tick = () => new Promise((r) => setTimeout(r, 30));

  it('takes one part of an upload at a time (409 for a second while one arrives)', async () => {
    const { record, token } = await newFilm();
    const other = await newFilm('other.mp4');
    const slow = slowPart(token, 0, new Uint8Array(100));
    await tick();
    const second = await put(token, 1, Buffer.alloc(10));
    expect(second.status).toBe(409);
    expect(await second.text()).toMatch(/another part of this upload is still arriving/i);
    // Another upload is not held up.
    expect((await put(other.token, 0, Buffer.alloc(10))).status).toBe(200);
    slow.release(new Uint8Array(50));
    expect((await slow.res).status).toBe(200);
    expect((await getUpload(record.uploadId))?.receivedBytes).toBe(150);
    expect((await put(token, 1, Buffer.alloc(10))).status).toBe(200);
  });

  it('checks the total again once the part is in place, and drops a part over it', async () => {
    uploadLimits.totalMaxBytes = 1500;
    const { record, token } = await newFilm();
    const slow = slowPart(token, 0, new Uint8Array(600));
    await tick();
    // Something past the one-part-at-a-time rule (another server process, say) adds a part.
    const parts = join(uploadsDir(), record.uploadId, 'parts');
    await writeFile(join(parts, '1'), Buffer.alloc(1000));
    slow.release();
    const res = await slow.res;
    expect(res.status).toBe(413);
    expect(await res.text()).toMatch(/film is too large/);
    expect(await readdir(parts)).toEqual(['1']);
    expect((await getUpload(record.uploadId))?.receivedBytes).toBe(1000);
  });

  it('refuses a part that is too big (413), by its length or by what arrives', async () => {
    uploadLimits.partMaxBytes = 1000;
    const { record, token } = await newFilm();
    expect((await put(token, 0, Buffer.alloc(1001))).status).toBe(413);
    // No Content-Length: counted as it arrives.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(600));
        c.enqueue(new Uint8Array(600));
        c.close();
      },
    });
    const streamed = await handlePart(
      token,
      '1',
      new Request('http://x/', { method: 'PUT', body: stream, duplex: 'half' } as RequestInit)
    );
    expect(streamed.status).toBe(413);
    expect(await readdir(join(uploadsDir(), record.uploadId, 'parts'))).toEqual([]);
    expect((await put(token, 0, Buffer.alloc(1000))).status).toBe(200);
  });

  it('holds the whole film to the total limit', async () => {
    uploadLimits.totalMaxBytes = 1500;
    const { token } = await newFilm();
    expect((await put(token, 0, Buffer.alloc(1000))).status).toBe(200);
    const res = await put(token, 1, Buffer.alloc(600));
    expect(res.status).toBe(413);
    expect(await res.text()).toMatch(/film is too large/);
    // Replacing part 0 is measured without the part it replaces.
    expect((await put(token, 0, Buffer.alloc(1400))).status).toBe(200);
  });

  it('refuses part numbers outside 0 to 199, and empty parts', async () => {
    const { token } = await newFilm();
    for (const n of ['200', '-1', 'x', '1.5', '0001']) {
      expect((await put(token, n, Buffer.from('x'))).status).toBe(400);
    }
    expect((await put(token, '199', Buffer.from('x'))).status).toBe(200);
    expect((await put(token, 0, Buffer.alloc(0))).status).toBe(400);
  });

  it('answers 507 unless the disk has room for a whole part over the floor', async () => {
    uploadLimits.partMaxBytes = 1000;
    let free = limits.minFreeDiskBytes + 999;
    setUploadDiskProbeForTests(async () => free);
    const { token } = await newFilm();
    const res = await put(token, 0, Buffer.from('x'));
    expect(res.status).toBe(507);
    expect(await res.text()).toMatch(/short of disk space/);
    free += 1;
    expect((await put(token, 0, Buffer.from('x'))).status).toBe(200);

    // A part arriving for another upload holds its room against the disk too.
    const other = await newFilm('other.mp4');
    const slow = slowPart(other.token, 0, new Uint8Array(10));
    await tick();
    expect((await put(token, 1, Buffer.from('x'))).status).toBe(507);
    slow.release();
    expect((await slow.res).status).toBe(200);
    expect((await put(token, 1, Buffer.from('x'))).status).toBe(200);
  });

  it('says a done upload takes no more parts, and where to look', async () => {
    const { record, token } = await newFilm();
    const film = await readFile(fx('h264.mp4'));
    await sendAll(token, film, 1 << 20);
    expect((await handleFinish(token, String(film.length))).status).toBe(200);
    const res = await put(token, 0, Buffer.from('x'));
    expect(res.status).toBe(409);
    expect(await res.text()).toContain(`get_upload with uploadId "${record.uploadId}"`);
  });
});

describe('GET part', () => {
  it('answers the size of a stored part, or 404', async () => {
    const { record, token } = await newFilm();
    expect((await put(token, 3, Buffer.alloc(1234))).status).toBe(200);
    const res = await handlePartSize(token, '3');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('1234\n');
    for (const n of ['0', 'x', '-1']) expect((await handlePartSize(token, n)).status).toBe(404);
    expect((await handlePartSize(`${record.uploadId}.${'D'.repeat(43)}`, '3')).status).toBe(404);
    // Half-written parts are not parts.
    await writeFile(join(uploadsDir(), record.uploadId, 'parts', '4.abc.tmp'), 'half');
    expect((await handlePartSize(token, '4')).status).toBe(404);
  });

  it('still answers once the link has expired: it only reads', async () => {
    uploadLimits.ttlMs = 50;
    const { token } = await newFilm();
    expect((await put(token, 0, Buffer.alloc(7))).status).toBe(200);
    await new Promise((r) => setTimeout(r, 80));
    expect(await (await handlePartSize(token, '0')).text()).toBe('7\n');
  });
});

describe('POST finish', () => {
  it('refuses when the parts do not add up, and stays open for the command to run again', async () => {
    const { record, token } = await newFilm();
    const film = await readFile(fx('h264.mp4'));
    await put(token, 0, film.subarray(0, 100_000));
    await put(token, 2, film.subarray(200_000, 300_000));

    let res = await handleFinish(token, String(film.length));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, reason: expect.stringMatching(/Part 1/) });

    await put(token, 1, film.subarray(100_000, 200_000));
    res = await handleFinish(token, String(film.length));
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toMatch(/add up to 300000 bytes/);
    expect((await getUpload(record.uploadId))?.state).toBe('receiving');

    expect((await handleFinish(token, null)).status).toBe(400);
    expect((await handleFinish(token, 'lots')).status).toBe(400);

    // The rest arrives: now it goes through.
    await put(token, 3, film.subarray(300_000));
    res = await handleFinish(token, String(film.length));
    expect(res.status).toBe(200);
  });

  it('refuses a film over the total (413), and one the disk has no room to join (507)', async () => {
    uploadLimits.totalMaxBytes = 1000;
    const { token } = await newFilm();
    expect((await put(token, 0, Buffer.alloc(600))).status).toBe(200);
    const big = await handleFinish(token, '1001');
    expect(big.status).toBe(413);
    expect((await big.json()).reason).toMatch(/too large/);

    setUploadDiskProbeForTests(async () => limits.minFreeDiskBytes + 599);
    const short = await handleFinish(token, '600');
    expect(short.status).toBe(507);
    expect((await short.json()).reason).toMatch(/short of disk space/);
  });

  it('refuses a finish with no parts at all', async () => {
    const { token } = await newFilm();
    const res = await handleFinish(token, '0');
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toMatch(/No parts/);
  });

  it('joins the parts, imports the MP4 and answers the review link; again gives the same', async () => {
    process.env.PUBLIC_BASE_URL = 'https://fb.example.com';
    const { resetConfigForTests } = await import('@/lib/config');
    resetConfigForTests();
    try {
      const { record, token } = await newFilm();
      const film = await readFile(fx('h264.mp4'));
      await sendAll(token, film, 100_000);
      const res = await handleFinish(token, String(film.length));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        ok: true,
        state: 'done',
        version: 1,
        reviewUrl: expect.stringMatching(/^https:\/\/fb\.example\.com\/r\/[\w-]{43}$/),
      });
      expect(body.next).toBe(
        `Give the review link to Tim, not to reviewers. Call wait_for_feedback with videoId "${body.videoId}" and no cursor: it answers at once with a cursor; call it again with that cursor to wait for comments.`
      );
      const video = await getVideo(body.videoId);
      expect(video).toMatchObject({ title: 'Launch film', latestVersion: 1 });
      expect(video?.versions[0].originalFilename).toBe('film.mp4');
      // The inbox copy and the parts are gone.
      expect(await readdir(inboxDir())).toEqual([]);
      expect(existsSync(join(uploadsDir(), record.uploadId, 'parts'))).toBe(false);
      expect(await getUpload(record.uploadId)).toMatchObject({
        state: 'done',
        result: { videoId: body.videoId, version: 1, reviewUrl: body.reviewUrl },
      });

      const again = await handleFinish(token, String(film.length));
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(body);
      expect((await put(token, 0, Buffer.from('x'))).status).toBe(409);
    } finally {
      delete process.env.PUBLIC_BASE_URL;
      const { resetConfigForTests } = await import('@/lib/config');
      resetConfigForTests();
    }
  });

  it('imports a packed Talkie film as the next version of a video', async () => {
    const first = await newFilm('film.mp4');
    const mp4 = await readFile(fx('h264.mp4'));
    await sendAll(first.token, mp4, 1 << 20);
    const { videoId } = await (await handleFinish(first.token, String(mp4.length))).json();

    const { token } = await createUpload({
      filename: 'roof.lottie',
      mode: 'version',
      videoId,
      createdBy: 'service token',
    });
    const film = await readFile(TALKIE_MINI_LOTTIE);
    await sendAll(token, film, 20_000);
    const res = await handleFinish(token, String(film.length));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, videoId, version: 2 });
    expect((await getVideo(videoId))?.versions[1]).toMatchObject({ mediaKind: 'talkie' });
  });

  it('answers 422 when the import is refused, and leaves the film in the inbox', async () => {
    const { record, token } = await newFilm('bad.mp4');
    const film = await readFile(fx('mpeg4.mp4'));
    await sendAll(token, film, 50_000);
    const res = await handleFinish(token, String(film.length));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      state: 'failed',
      reason: expect.stringMatching(/H\.264/),
      inboxFile: 'bad.mp4',
    });
    expect(body.next).toContain(
      'call import_from_inbox with filename "bad.mp4", mode "new" and title "Launch film"'
    );
    expect(existsSync(join(inboxDir(), 'bad.mp4'))).toBe(true);
    expect((await getUpload(record.uploadId))?.state).toBe('failed');
    expect((await handleFinish(token, String(film.length))).status).toBe(422);
  });

  it('adds -2 when the name is taken in the inbox', async () => {
    await mkdir(inboxDir(), { recursive: true });
    await copyFile(fx('mpeg4.mp4'), join(inboxDir(), 'film.mp4'));
    await writeFile(join(inboxDir(), 'film-2.mp4'), 'taken too');
    const { token } = await newFilm('film.mp4');
    const film = await readFile(fx('h264.mp4'));
    await sendAll(token, film, 1 << 20);
    const res = await handleFinish(token, String(film.length));
    expect(res.status).toBe(200);
    const { videoId } = await res.json();
    expect((await getVideo(videoId))?.versions[0].originalFilename).toBe('film-3.mp4');
    // Neither earlier file was touched.
    expect((await readdir(inboxDir())).sort()).toEqual(['film-2.mp4', 'film.mp4']);
    expect(await readFile(join(inboxDir(), 'film-2.mp4'), 'utf8')).toBe('taken too');
  });

  it('answers "still importing" when the import takes long, and 409 to a second finish', async () => {
    uploadLimits.finishWaitMs = 0;
    const { record, token } = await newFilm();
    const film = await readFile(fx('h264.mp4'));
    await sendAll(token, film, 1 << 20);
    const res = await handleFinish(token, String(film.length));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      state: 'importing',
      uploadId: record.uploadId,
      next: expect.stringMatching(/get_upload/),
    });
    const second = await handleFinish(token, String(film.length));
    // Unless the import already won the race, a second finish is told to wait.
    if (second.status !== 200) expect(second.status).toBe(409);
    for (let i = 0; i < 300 && (await getUpload(record.uploadId))?.state !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect((await getUpload(record.uploadId))?.state).toBe('done');
  });

  it('answers 404 for a wrong token and 410 once expired', async () => {
    uploadLimits.ttlMs = 50;
    const { record, token } = await newFilm();
    expect((await handleFinish(`${record.uploadId}.${'C'.repeat(43)}`, '1')).status).toBe(404);
    await new Promise((r) => setTimeout(r, 80));
    expect((await handleFinish(token, '1')).status).toBe(410);
  });

  it('keeps everything under the data folder', async () => {
    await newFilm();
    expect(uploadsDir().startsWith(dir)).toBe(true);
  });
});
