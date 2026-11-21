import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeJsonAtomic } from '@/lib/storage/json';
import { commentDir } from '@/lib/storage/paths';
import { createSession, createVideo, saveSession, writeCommentMeta } from '@/lib/storage/repo';
import type { CommentMeta, CommentState, SessionRecord } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { summariseSessions } from './sessions';

let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ cleanup } = await withTmpData());
});
afterEach(() => cleanup());

async function seedComment(session: SessionRecord, state: CommentState | null): Promise<void> {
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
  await writeJsonAtomic(join(commentDir(ref), 'status.json'), {
    state,
    steps: {},
    error: null,
    attempts: 0,
    updatedAt: '2026-11-01T10:00:00.000Z',
  });
}

it('returns nothing for a video with no sessions', async () => {
  const video = await createVideo('Quiet');
  expect(await summariseSessions(video.videoId)).toEqual([]);
});

it('counts comments per session, newest session first', async () => {
  const video = await createVideo('Launch film');
  const ann = await createSession(video.videoId, 1, 'Ann', 'ua');
  await saveSession({
    ...ann,
    startedAt: '2026-11-01T08:00:00.000Z',
    doneAt: '2026-11-01T08:30:00.000Z',
  });
  await seedComment(ann, 'done');
  await seedComment(ann, 'empty');
  await seedComment(ann, 'failed');
  await seedComment(ann, null);

  const bob = await createSession(video.videoId, 1, 'Bob', 'ua');
  await saveSession({ ...bob, startedAt: '2026-11-02T08:00:00.000Z' });

  expect(await summariseSessions(video.videoId)).toEqual([
    {
      sessionId: bob.sessionId,
      version: 1,
      reviewerName: 'Bob',
      startedAt: '2026-11-02T08:00:00.000Z',
      doneAt: null,
      comments: 0,
      emptyComments: 0,
      failedComments: 0,
    },
    {
      sessionId: ann.sessionId,
      version: 1,
      reviewerName: 'Ann',
      startedAt: '2026-11-01T08:00:00.000Z',
      doneAt: '2026-11-01T08:30:00.000Z',
      comments: 4,
      emptyComments: 1,
      failedComments: 1,
    },
  ]);
});
