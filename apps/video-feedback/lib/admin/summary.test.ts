import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '@/lib/storage/json';
import { commentDir, sessionDir } from '@/lib/storage/paths';
import {
  createSession,
  createVideo,
  saveSession,
  saveVideo,
  writeCommentMeta,
} from '@/lib/storage/repo';
import type { CommentMeta, CommentState, CommentStatus, SessionRecord } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { summariseVideos } from './summary';

let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ cleanup } = await withTmpData());
});
afterEach(() => cleanup());

async function seedComment(
  session: SessionRecord,
  state: CommentState | null,
  updatedAt = '2026-11-01T10:00:00.000Z',
  clip: CommentStatus['steps']['clip'] = 'done'
): Promise<void> {
  const ref = { videoId: session.videoId, sessionId: session.sessionId, commentId: randomUUID() };
  const meta: CommentMeta = {
    commentId: ref.commentId,
    sessionId: ref.sessionId,
    version: session.version,
    kind: 'moment',
    pausedAtVideoTime: 1,
    startedAt: '2026-11-01T09:00:00.000Z',
    endedAt: null,
    durationMs: null,
    audioMime: 'audio/webm',
    totalChunks: null,
    player: {
      containerWidth: 640,
      containerHeight: 360,
      videoWidth: 640,
      videoHeight: 360,
      contentRect: { x: 0, y: 0, width: 640, height: 360 },
      fullscreen: false,
      devicePixelRatio: 1,
    },
  };
  await writeCommentMeta(ref, meta);
  if (state === null) return;
  const status: CommentStatus = {
    state,
    steps: {
      audio: 'pending',
      silence: 'pending',
      transcribe: 'pending',
      moments: 'pending',
      stills: 'pending',
      clip,
    },
    error: null,
    attempts: 0,
    updatedAt,
  };
  await writeJsonAtomic(join(commentDir(ref), 'status.json'), status);
}

async function seedVideo(title: string, versions: number) {
  const video = await createVideo(title);
  video.latestVersion = versions;
  video.versions = Array.from({ length: versions }, (_, i) => ({
    version: i + 1,
    importedAt: '2026-10-01T00:00:00.000Z',
    originalFilename: `v${i + 1}.mp4`,
  }));
  await saveVideo(video);
  return video;
}

it('returns an empty list when there are no videos', async () => {
  expect(await summariseVideos('https://fb.example.com')).toEqual([]);
});

it('summarises counts per version including pending processing', async () => {
  const video = await seedVideo('Launch film', 2);

  const s1 = await createSession(video.videoId, 1, 'Ann', 'ua');
  await saveSession({
    ...s1,
    startedAt: '2026-11-01T08:00:00.000Z',
    doneAt: '2026-11-01T08:30:00.000Z',
  });
  await seedComment(s1, 'done');

  const s2 = await createSession(video.videoId, 2, 'Bob', 'ua');
  await saveSession({ ...s2, startedAt: '2026-11-02T08:00:00.000Z' });
  await seedComment(s2, 'done');
  await seedComment(s2, 'empty');
  await seedComment(s2, 'failed');
  await seedComment(s2, 'queued');
  await seedComment(s2, 'processing', '2026-11-03T12:00:00.000Z');
  await seedComment(s2, 'receiving');
  await seedComment(s2, null);
  const s3 = await createSession(video.videoId, 2, 'Cat', 'ua');
  await saveSession({ ...s3, startedAt: '2026-11-02T09:00:00.000Z' });

  expect(await summariseVideos('https://fb.example.com')).toEqual([
    {
      videoId: video.videoId,
      title: 'Launch film',
      reviewUrl: `https://fb.example.com/r/${video.token}`,
      latestVersion: 2,
      versions: [
        {
          version: 1,
          sessions: 1,
          comments: 1,
          emptyComments: 0,
          failedComments: 0,
          pendingProcessing: 0,
          lastActivity: '2026-11-01T10:00:00.000Z',
        },
        {
          version: 2,
          sessions: 2,
          comments: 7,
          emptyComments: 1,
          failedComments: 1,
          // queued, processing, and the upload that stopped weeks ago without completing
          pendingProcessing: 3,
          lastActivity: '2026-11-03T12:00:00.000Z',
        },
      ],
    },
  ]);
});

it('gives zero counts and no activity for a version nobody has reviewed', async () => {
  const video = await seedVideo('Quiet', 1);
  const [summary] = await summariseVideos('http://localhost:3000/');
  expect(summary.reviewUrl).toBe(`http://localhost:3000/r/${video.token}`);
  expect(summary.versions).toEqual([
    {
      version: 1,
      sessions: 0,
      comments: 0,
      emptyComments: 0,
      failedComments: 0,
      pendingProcessing: 0,
      lastActivity: null,
    },
  ]);
});

it('lists the newest video first', async () => {
  const a = await seedVideo('Older', 1);
  await saveVideo({ ...a, createdAt: '2026-01-01T00:00:00.000Z' });
  const b = await seedVideo('Newer', 1);
  await saveVideo({ ...b, createdAt: '2026-02-01T00:00:00.000Z' });
  expect((await summariseVideos('http://x')).map((v) => v.title)).toEqual(['Newer', 'Older']);
});

it('counts a finished comment whose clip is not rendered yet as pending', async () => {
  const video = await seedVideo('Clips', 1);
  const s = await createSession(video.videoId, 1, 'Ann', 'ua');
  await seedComment(s, 'done', undefined, 'pending');
  await seedComment(s, 'done', undefined, 'done');
  await seedComment(s, 'done', undefined, 'skipped');
  await seedComment(s, 'failed', undefined, 'pending');
  const [summary] = await summariseVideos('http://x');
  expect(summary.versions[0]).toMatchObject({ comments: 4, pendingProcessing: 1 });
});

it('counts an upload that has gone quiet as pending, but not one in progress', async () => {
  const video = await seedVideo('Uploads', 1);
  const s = await createSession(video.videoId, 1, 'Ann', 'ua');
  await seedComment(s, 'receiving', new Date().toISOString());
  await seedComment(s, 'receiving', new Date(Date.now() - 2 * 3_600_000).toISOString());
  const [summary] = await summariseVideos('http://x');
  expect(summary.versions[0]).toMatchObject({ comments: 2, pendingProcessing: 1 });
});

it('skips a session whose session.json is corrupt instead of failing the whole list', async () => {
  const video = await seedVideo('Robust', 1);
  const good = await createSession(video.videoId, 1, 'Ann', 'ua');
  const bad = await createSession(video.videoId, 1, 'Bob', 'ua');
  await writeFile(join(sessionDir(video.videoId, bad.sessionId), 'session.json'), '{"sessio');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const [summary] = await summariseVideos('http://x');
  expect(summary.versions[0].sessions).toBe(1);
  expect(good.sessionId).toBeTruthy();
  expect(errors).toHaveBeenCalled();
  errors.mockRestore();
});
