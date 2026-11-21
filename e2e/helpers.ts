import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { T } from '@/lib/testids';
import type {
  CaptureEvent,
  CommentMeta,
  CommentRef,
  CommentState,
  CommentStatus,
  PlayerInfo,
  SessionRecord,
} from '@/lib/types';
import { FIXTURES, STATE_FILE, type E2EState } from './paths';

export { T };

export function state(): E2EState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2EState;
}

function readJson<V>(path: string): V | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as V) : null;
}

function dirs(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((name) => statSync(join(path, name)).isDirectory());
}

function filesUnder(root: string, dir = root): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(root, full) : [relative(root, full)];
  });
}

const videosDir = () => join(state().dataDir, 'videos');
const commentPath = (ref: CommentRef) =>
  join(videosDir(), ref.videoId, 'sessions', ref.sessionId, 'comments', ref.commentId);

export function findSessions(reviewerName: string): SessionRecord[] {
  return dirs(videosDir()).flatMap((videoId) =>
    dirs(join(videosDir(), videoId, 'sessions'))
      .map((sid) =>
        readJson<SessionRecord>(join(videosDir(), videoId, 'sessions', sid, 'session.json'))
      )
      .filter((s): s is SessionRecord => s !== null && s.reviewerName === reviewerName)
  );
}

export interface StoredComment {
  ref: CommentRef;
  meta: CommentMeta;
  status: CommentStatus | null;
  events: CaptureEvent[];
  files: string[];
}

/** Events come from events.json once assembled, otherwise from the stored chunks. */
function readEvents(dir: string): CaptureEvent[] {
  const assembled = readJson<CaptureEvent[]>(join(dir, 'events.json'));
  if (assembled) return assembled;
  return filesUnder(dir)
    .filter((f) => /events.*\.json$/.test(f) && f !== 'events.json')
    .sort()
    .flatMap((f) => readJson<CaptureEvent[]>(join(dir, f)) ?? []);
}

export function readComment(ref: CommentRef): StoredComment | null {
  const dir = commentPath(ref);
  const meta = readJson<CommentMeta>(join(dir, 'meta.json'));
  if (!meta) return null;
  return {
    ref,
    meta,
    status: readJson<CommentStatus>(join(dir, 'status.json')),
    events: readEvents(dir),
    files: filesUnder(dir),
  };
}

/** Every comment of every session the named reviewer started. */
export async function readSessionComments(reviewerName: string): Promise<StoredComment[]> {
  return findSessions(reviewerName).flatMap((s) =>
    dirs(join(videosDir(), s.videoId, 'sessions', s.sessionId, 'comments'))
      .map((commentId) => readComment({ videoId: s.videoId, sessionId: s.sessionId, commentId }))
      .filter((c): c is StoredComment => c !== null)
  );
}

export async function waitForState(
  ref: CommentRef,
  wanted: CommentState,
  timeout = 60_000
): Promise<StoredComment> {
  await expect
    .poll(() => readComment(ref)?.status?.state, { timeout, intervals: [500, 1000] })
    .toBe(wanted);
  return readComment(ref) as StoredComment;
}

/** Name, mic explain, mic check: leaves the reviewer on the paused player. */
export async function startReview(
  page: Page,
  name: string,
  url = state().reviewUrl
): Promise<void> {
  await page.goto(url);
  await page.getByTestId(T.nameInput).fill(name);
  await page.getByTestId(T.startButton).click();
  await passMicCheck(page);
}

export async function passMicCheck(page: Page): Promise<void> {
  await page.getByTestId(T.micContinue).click();
  await expect(page.getByTestId(T.micHeard)).toBeVisible({ timeout: 10_000 });
  await page.getByTestId(T.startWatching).click();
  await expect(page.getByTestId(T.player)).toBeVisible();
}

/** Plays for a moment, pauses (starting a comment), talks, and resumes play to end it. */
export async function giveComment(page: Page, talkMs = 2500): Promise<void> {
  await page.getByTestId(T.playPause).click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.listening)).toBeVisible();
  await page.waitForTimeout(talkMs);
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.savedToast)).toBeVisible({ timeout: 20_000 });
}

export async function stageBox(page: Page) {
  const box = await page.getByTestId(T.videoStage).boundingBox();
  if (!box) throw new Error('video stage has no box');
  return box;
}

const PLAYER: PlayerInfo = {
  containerWidth: 1280,
  containerHeight: 720,
  videoWidth: 640,
  videoHeight: 360,
  contentRect: { x: 0, y: 0, width: 1280, height: 720 },
  fullscreen: false,
  devicePixelRatio: 1,
};

/** A whole review through the API: one session, one moment comment from speech-like.webm. */
export async function apiReview(
  request: APIRequestContext,
  video: { token: string; videoId: string },
  reviewerName: string
): Promise<CommentRef> {
  const { token, videoId } = video;
  const created = await request.post(`/api/r/${token}/sessions`, {
    data: { reviewerName, userAgent: 'playwright-api' },
  });
  expect(created.status()).toBe(200);
  const { sessionId, version } = (await created.json()) as { sessionId: string; version: number };
  const commentId = randomUUID();
  const meta: CommentMeta = {
    commentId,
    sessionId,
    version,
    kind: 'moment',
    pausedAtVideoTime: 1,
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationMs: null,
    audioMime: 'audio/webm;codecs=opus',
    totalChunks: null,
    player: PLAYER,
  };
  const events: CaptureEvent[] = [
    { type: 'pointer', t: 100, x: 0.5, y: 0.5, inside: true, vt: 1 },
    { type: 'click', t: 900, x: 0.5, y: 0.5, inside: true, vt: 1, button: 0 },
  ];
  const audio = readFileSync(join(FIXTURES, 'speech-like.webm'));
  const put = await request.put(
    `/api/r/${token}/sessions/${sessionId}/comments/${commentId}/chunks/0`,
    {
      multipart: {
        audio: { name: 'chunk.webm', mimeType: 'audio/webm', buffer: audio },
        events: JSON.stringify(events),
        meta: JSON.stringify(meta),
      },
    }
  );
  expect(put.status()).toBe(200);
  const done = await request.post(
    `/api/r/${token}/sessions/${sessionId}/comments/${commentId}/complete`,
    {
      data: {
        totalChunks: 1,
        endedAt: new Date().toISOString(),
        durationMs: 3000,
        player: PLAYER,
      },
    }
  );
  expect(done.status()).toBe(200);
  const finish = await request.post(`/api/r/${token}/sessions/${sessionId}/done`);
  expect(finish.ok()).toBe(true);
  return { videoId, sessionId, commentId };
}
