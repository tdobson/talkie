import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommentMeta, CommentRef } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { isUuid } from './ids';
import { commentDir, ID_RE, sessionDir, videoDir } from './paths';
import {
  createSession,
  createVideo,
  findVideoByToken,
  getSession,
  getVideo,
  listComments,
  listSessions,
  listVideos,
  readCommentMeta,
  saveSession,
  saveVideo,
  writeCommentMeta,
} from './repo';

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ dir, cleanup } = await withTmpData());
});
afterEach(() => cleanup());

it('findVideoByToken finds by token and ignores near misses', async () => {
  const v = await createVideo('Mavala launch');
  expect((await findVideoByToken(v.token))?.videoId).toBe(v.videoId);
  expect(await findVideoByToken(`${v.token.slice(0, -1)}x`)).toBeNull();
});

it('findVideoByToken handles junk input', async () => {
  await createVideo('One');
  for (const bad of ['', 'short', 'x'.repeat(5000), '../../etc/passwd']) {
    expect(await findVideoByToken(bad)).toBeNull();
  }
});

it('findVideoByToken sees a video saved after the first lookup', async () => {
  const a = await createVideo('A');
  expect((await findVideoByToken(a.token))?.videoId).toBe(a.videoId);
  const b = await createVideo('B');
  expect((await findVideoByToken(b.token))?.videoId).toBe(b.videoId);
});

it('findVideoByToken returns the saved state, not a stale copy', async () => {
  const v = await createVideo('A');
  await findVideoByToken(v.token);
  await saveVideo({
    ...v,
    latestVersion: 1,
    versions: [{ version: 1, importedAt: 'now', originalFilename: 'a.mp4' }],
  });
  expect((await findVideoByToken(v.token))?.latestVersion).toBe(1);
});

it('createVideo writes video.json with no versions yet', async () => {
  const v = await createVideo('Mavala launch');
  expect(v.videoId).toMatch(ID_RE);
  expect(v.videoId).toMatch(/^mavala-launch-/);
  expect(v).toMatchObject({ title: 'Mavala launch', latestVersion: 0, versions: [] });
  expect(Number.isNaN(Date.parse(v.createdAt))).toBe(false);
  expect(await getVideo(v.videoId)).toEqual(v);
});

it('getVideo returns null for unknown and throws for unsafe ids', async () => {
  expect(await getVideo('nope-1234')).toBeNull();
  await expect(getVideo('../x')).rejects.toThrow();
});

it('listVideos lists everything, oldest first, skipping stray entries', async () => {
  expect(await listVideos()).toEqual([]);
  const a = await createVideo('A');
  const b = await createVideo('B');
  await saveVideo({ ...a, createdAt: '2026-01-02T00:00:00.000Z' });
  await saveVideo({ ...b, createdAt: '2026-01-01T00:00:00.000Z' });
  await mkdir(join(dir, 'videos/half-made-0000'), { recursive: true });
  await writeFile(join(dir, 'videos/.DS_Store'), '');
  expect((await listVideos()).map((v) => v.videoId)).toEqual([b.videoId, a.videoId]);
});

it('creates, reads, saves and lists sessions', async () => {
  const v = await createVideo('A');
  const s = await createSession(v.videoId, 1, 'Sarah', 'UA/1');
  expect(isUuid(s.sessionId)).toBe(true);
  expect(s).toMatchObject({
    videoId: v.videoId,
    version: 1,
    reviewerName: 'Sarah',
    userAgent: 'UA/1',
    doneAt: null,
  });
  expect(await getSession(v.videoId, s.sessionId)).toEqual(s);
  await saveSession({ ...s, doneAt: '2026-11-21T12:00:00.000Z' });
  expect((await getSession(v.videoId, s.sessionId))?.doneAt).toBe('2026-11-21T12:00:00.000Z');
  const s2 = await createSession(v.videoId, 1, 'Bob', 'UA/2');
  expect((await listSessions(v.videoId)).map((x) => x.sessionId).sort()).toEqual(
    [s.sessionId, s2.sessionId].sort()
  );
});

it('session lookups are null or empty for unknown things and throw for unsafe ids', async () => {
  const v = await createVideo('A');
  expect(await getSession(v.videoId, crypto.randomUUID())).toBeNull();
  expect(await listSessions(v.videoId)).toEqual([]);
  expect(await listSessions('nope-1234')).toEqual([]);
  await expect(getSession(v.videoId, '../x')).rejects.toThrow();
  await expect(createSession('../x', 1, 'n', 'ua')).rejects.toThrow();
});

it('a session in one video is not visible through another', async () => {
  const a = await createVideo('A');
  const b = await createVideo('B');
  const s = await createSession(a.videoId, 1, 'Sarah', 'UA');
  expect(await getSession(b.videoId, s.sessionId)).toBeNull();
});

it('reads, writes and lists comments', async () => {
  const v = await createVideo('A');
  const s = await createSession(v.videoId, 1, 'Sarah', 'UA');
  expect(await listComments(v.videoId, s.sessionId)).toEqual([]);
  const ref: CommentRef = {
    videoId: v.videoId,
    sessionId: s.sessionId,
    commentId: crypto.randomUUID(),
  };
  expect(await readCommentMeta(ref)).toBeNull();
  const meta: CommentMeta = {
    commentId: ref.commentId,
    sessionId: s.sessionId,
    version: 1,
    kind: 'moment',
    pausedAtVideoTime: 12.4,
    startedAt: '2026-11-21T12:00:00.000Z',
    endedAt: null,
    durationMs: null,
    audioMime: 'audio/webm;codecs=opus',
    totalChunks: null,
    player: {
      containerWidth: 1280,
      containerHeight: 720,
      videoWidth: 1920,
      videoHeight: 1080,
      contentRect: { x: 0, y: 0, width: 1280, height: 720 },
      fullscreen: false,
      devicePixelRatio: 2,
    },
  };
  await writeCommentMeta(ref, meta);
  expect(await readCommentMeta(ref)).toEqual(meta);
  await mkdir(join(commentDir(ref), '..', 'not-a-comment'));
  expect(await listComments(v.videoId, s.sessionId)).toEqual([ref]);
  await expect(readCommentMeta({ ...ref, commentId: '../x' })).rejects.toThrow();
});

it('one corrupt video.json does not take the other videos, or the review links, down', async () => {
  const good = await createVideo('Good');
  const bad = await createVideo('Bad');
  await writeFile(join(videoDir(bad.videoId), 'video.json'), '{"videoId": "tru');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await listVideos()).map((v) => v.videoId)).toEqual([good.videoId]);
  expect((await findVideoByToken(good.token))?.videoId).toBe(good.videoId);
  expect(await findVideoByToken(bad.token)).toBeNull();
  expect(errors).toHaveBeenCalled();
  errors.mockRestore();
});

it('one corrupt session.json does not hide the other sessions', async () => {
  const v = await createVideo('Sessions');
  const good = await createSession(v.videoId, 1, 'Ann', 'ua');
  const bad = await createSession(v.videoId, 1, 'Bob', 'ua');
  await writeFile(join(sessionDir(v.videoId, bad.sessionId), 'session.json'), '');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await listSessions(v.videoId)).map((x) => x.sessionId)).toEqual([good.sessionId]);
  errors.mockRestore();
});
