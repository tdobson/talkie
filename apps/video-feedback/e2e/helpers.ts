import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type APIRequestContext, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import yauzl from 'yauzl';
import { T } from '@/lib/testids';
import type {
  AdminVideoSummary,
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
    try {
      return statSync(full).isDirectory() ? filesUnder(root, full) : [relative(root, full)];
    } catch {
      // The server writes through temporary files and renames them: one can go between the
      // listing and the stat. It was never part of the comment.
      return [];
    }
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

/**
 * Name, the microphone, hello and the practice run: leaves the reviewer watching the film,
 * playing from the start. This is a first visit in a fresh browser context.
 */
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

/**
 * Past the microphone explanation, if it is shown at all: a browser that already allows the
 * microphone goes straight on.
 */
export async function continueMic(
  page: Page,
  /** Runs on the explanation screen, when there is one, before Continue. */
  onExplain?: () => Promise<void>
): Promise<void> {
  const button = page.getByTestId(T.micContinue);
  const past = page
    .getByTestId(T.micCheck)
    .or(page.getByTestId(T.starting))
    .or(page.getByTestId(T.player))
    .or(page.getByTestId(T.micDenied));
  await expect(button.or(past).first()).toBeVisible({ timeout: 15_000 });
  if (await button.isVisible()) {
    await onExplain?.();
    await button.click();
  }
}

/**
 * The microphone, then the hello check (no button: it moves on by itself once it hears the fake
 * microphone), then the practice run. A browser that has done them before skips hello and the
 * practice: pass `practice: false` (and `hello` follows it unless given). The player is then
 * left paused, as it opens.
 */
export async function passMicCheck(
  page: Page,
  {
    practice = true,
    talk = true,
    hello = practice,
  }: { practice?: boolean; talk?: boolean; hello?: boolean } = {}
): Promise<void> {
  await continueMic(page);
  if (hello) await expect(page.getByTestId(T.micHeard)).toBeVisible({ timeout: 10_000 });
  else await expect(page.getByTestId(T.micCheck)).toHaveCount(0);
  await expect(page.getByTestId(T.player)).toBeVisible({ timeout: 10_000 });
  if (practice) await doPractice(page, { talk });
  else {
    await expect(page.getByTestId(T.practiceIntro)).toHaveCount(0);
    await expect(page.getByTestId(T.coachMark)).toHaveCount(0);
  }
}

/**
 * The practice run: a card says it is practice and how feedback works; Start practice plays the
 * film under the practice banner with a coach mark on Pause. Pausing listens; with `talk` the
 * fake microphone talks, "Got that" shows as soon as it is heard, and the film starts again
 * from the beginning for real. Without it (a silent microphone) the reviewer presses play to
 * carry on. Either way nothing is saved, and the film ends up playing from the start.
 */
export async function doPractice(page: Page, { talk = true }: { talk?: boolean } = {}) {
  const playPause = page.getByTestId(T.playPause);
  await expect(page.getByTestId(T.practiceIntro)).toBeVisible();
  await expect(page.getByTestId(T.practiceBanner)).toBeVisible();
  await expect(page.getByTestId(T.practiceStart)).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId(T.practiceStart).click();
  await expect(playPause).toHaveAttribute('aria-label', 'Pause', { timeout: 20_000 });
  await expect(page.getByTestId(T.coachMark)).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.practiceListening)).toBeVisible();
  if (talk) {
    await expect(page.getByTestId(T.practiceGotThat)).toBeVisible({ timeout: 15_000 });
  } else {
    await page.keyboard.press('Space');
  }
  await expect(playPause).toHaveAttribute('aria-label', 'Pause', { timeout: 10_000 });
  await expect(page.getByTestId(T.coachMark)).toHaveCount(0);
  await expect(page.getByTestId(T.practiceListening)).toHaveCount(0);
  await expect(page.getByTestId(T.practiceBanner)).toHaveCount(0);
}

/**
 * Plays for a moment, pauses (starting a comment), talks, and resumes play to end it. Works from
 * a paused player or the end screen; a player that is still playing (as the last comment left
 * it) is paused straight away, since clicking play-pause would pause it instead of playing.
 */
export async function giveComment(page: Page, talkMs = 2500): Promise<void> {
  const playPause = page.getByTestId(T.playPause);
  if ((await playPause.getAttribute('aria-label')) !== 'Pause') {
    await playPause.click();
    await expect(playPause).toHaveAttribute('aria-label', 'Pause');
    await page.waitForTimeout(800);
  }
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

/** Every file in a zip, by name. */
export function unzip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const files = new Map<string, Buffer>();
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e);
          const parts: Buffer[] = [];
          stream.on('data', (b: Buffer) => parts.push(b));
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(parts));
            zip.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zip.on('end', () => resolve(files));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

/** The RGB of an image's centre pixel. */
export async function centrePixel(image: Buffer): Promise<[number, number, number]> {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const x = Math.floor(info.width / 2);
  const y = Math.floor(info.height / 2);
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

/** Waits until nothing of a video is still processing, then downloads its export zip. */
export async function exportWhenReady(
  request: APIRequestContext,
  videoId: string,
  timeout = 150_000
): Promise<Map<string, Buffer>> {
  await expect
    .poll(
      async () => {
        const res = await request.get('/api/admin/videos');
        const all = (await res.json()) as AdminVideoSummary[];
        const v = all.find((x) => x.videoId === videoId);
        return v ? v.versions.reduce((n, ver) => n + ver.pendingProcessing, 0) : -1;
      },
      { timeout, intervals: [1000] }
    )
    .toBe(0);
  const zip = await request.get(`/api/admin/videos/${videoId}/export.zip`);
  expect(zip.status()).toBe(200);
  return unzip(await zip.body());
}
