import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_CHUNK_BYTES, MAX_CHUNK_REQUESTS_PER_MIN, MAX_COMMENT_BYTES } from '@/lib/constants';
import { notifyCommentComplete } from '@/lib/pipeline/enqueue';
import { missingChunks, putChunk, storedBytes } from '@/lib/storage/chunks';
import { isUuid } from '@/lib/storage/ids';
import { readJson, writeJsonAtomic } from '@/lib/storage/json';
import { commentDir } from '@/lib/storage/paths';
import {
  createSession,
  findVideoByToken,
  getSession,
  readCommentMeta,
  saveSession,
  writeCommentMeta,
} from '@/lib/storage/repo';
import type {
  CaptureEvent,
  CommentMeta,
  CommentRef,
  CommentStatus,
  CompleteBody,
  CompleteResult,
  CreateSessionBody,
  CreateSessionResult,
  GetSessionResult,
  MissingChunksResult,
  PlayerInfo,
  Rect,
  SessionRecord,
  VideoRecord,
} from '@/lib/types';
import { allowRequest } from './ratelimit';

export { parseRange } from './range';

export const MAX_NAME_LENGTH = 80;
export const MAX_EVENTS_PER_CHUNK = 20_000;
/** Far above any real comment (a chunk is 2 seconds), low enough to bound the work per request. */
export const MAX_CHUNKS_PER_COMMENT = 10_000;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_MIME_LENGTH = 100;
const RATE_WINDOW_MS = 60_000;

const NOT_FOUND = { error: 'not found' } as const;

/** The request reached a real session but its content is malformed. Routes answer 400. */
export class ReviewInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewInputError';
  }
}

// Validation helpers

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isIsoTime(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
}

function parseRect(v: unknown): Rect | null {
  if (!isDict(v)) return null;
  const { x, y, width, height } = v;
  if (![x, y, width, height].every(isFiniteNumber)) return null;
  return { x, y, width, height } as Rect;
}

/** Copies the known fields of a `PlayerInfo`, or returns null if any is missing or mistyped. */
function parsePlayer(v: unknown): PlayerInfo | null {
  if (!isDict(v)) return null;
  const { containerWidth, containerHeight, videoWidth, videoHeight, devicePixelRatio } = v;
  const numbers = [containerWidth, containerHeight, videoWidth, videoHeight, devicePixelRatio];
  if (!numbers.every((n) => isFiniteNumber(n) && n >= 0)) return null;
  const contentRect = parseRect(v.contentRect);
  if (contentRect === null || typeof v.fullscreen !== 'boolean') return null;
  return {
    containerWidth,
    containerHeight,
    videoWidth,
    videoHeight,
    contentRect,
    fullscreen: v.fullscreen,
    devicePixelRatio,
  } as PlayerInfo;
}

/** An empty MIME is allowed: a browser recording in its default format may not name it. */
const MIME_RE = /^(audio|video)\/[a-z0-9.+-]+(\s*;.*)?$/i;

/**
 * Builds the `meta.json` of a new comment from what the client sent with chunk 0. Only the
 * fields the client owns at that point are taken; ids and version come from the session.
 */
function parseMeta(v: unknown, session: SessionRecord, commentId: string): CommentMeta | null {
  if (!isDict(v)) return null;
  const { kind, pausedAtVideoTime, startedAt, audioMime } = v;
  if (kind !== 'moment' && kind !== 'general') return null;
  if (pausedAtVideoTime !== null && !(isFiniteNumber(pausedAtVideoTime) && pausedAtVideoTime >= 0))
    return null;
  if (!isIsoTime(startedAt)) return null;
  if (typeof audioMime !== 'string' || audioMime.length > MAX_MIME_LENGTH) return null;
  if (audioMime !== '' && !MIME_RE.test(audioMime)) return null;
  const player = parsePlayer(v.player);
  if (player === null) return null;
  return {
    commentId,
    sessionId: session.sessionId,
    version: session.version,
    kind,
    pausedAtVideoTime,
    startedAt,
    endedAt: null,
    durationMs: null,
    audioMime,
    totalChunks: null,
    player,
  };
}

const EVENT_TYPES: ReadonlySet<string> = new Set<CaptureEvent['type']>([
  'pointer',
  'click',
  'seek',
  'zoom',
  'zoomPan',
  'visibility',
  'layout',
]);

/** Keeps the entries that are objects with a numeric `t` and a known `type`. Never throws. */
function cleanEvents(v: unknown): CaptureEvent[] {
  if (!Array.isArray(v)) return [];
  const out: CaptureEvent[] = [];
  for (const e of v.slice(0, MAX_EVENTS_PER_CHUNK)) {
    if (isDict(e) && isFiniteNumber(e.t) && typeof e.type === 'string' && EVENT_TYPES.has(e.type)) {
      out.push(e as unknown as CaptureEvent);
    }
  }
  return out;
}

function parseCompleteBody(v: unknown): CompleteBody {
  if (!isDict(v)) throw new ReviewInputError('Body must be a JSON object.');
  const { totalChunks, endedAt, durationMs, micLost } = v;
  if (
    typeof totalChunks !== 'number' ||
    !Number.isInteger(totalChunks) ||
    totalChunks < 1 ||
    totalChunks > MAX_CHUNKS_PER_COMMENT
  ) {
    throw new ReviewInputError(`totalChunks must be a whole number from 1 to 10000.`);
  }
  if (!isIsoTime(endedAt)) throw new ReviewInputError('endedAt must be an ISO date and time.');
  if (!isFiniteNumber(durationMs) || durationMs < 0) {
    throw new ReviewInputError('durationMs must be zero or more.');
  }
  const player = parsePlayer(v.player);
  if (player === null) throw new ReviewInputError('player is missing or not valid.');
  if (micLost !== undefined && typeof micLost !== 'boolean') {
    throw new ReviewInputError('micLost must be true or false.');
  }
  return {
    totalChunks,
    endedAt,
    durationMs,
    player,
    ...(micLost === undefined ? {} : { micLost }),
  };
}

// Comment status. The pipeline owns this file once a comment is queued; the reviewer API only
// creates it and moves it from `receiving` to `queued`.

const statusPath = (ref: CommentRef) => join(commentDir(ref), 'status.json');

function receivingStatus(): CommentStatus {
  return {
    state: 'receiving',
    steps: {
      audio: 'pending',
      silence: 'pending',
      transcribe: 'pending',
      moments: 'pending',
      stills: 'pending',
      clip: 'pending',
    },
    error: null,
    attempts: 0,
    updatedAt: new Date().toISOString(),
  };
}

// One writer at a time per comment, so "check then write" steps (size limit, first meta,
// completion) cannot interleave. Shared on `globalThis` like the rate-limit store.

const LOCKS_KEY = Symbol.for('video-feedback.commentLocks');
const lockHolder = globalThis as unknown as Record<
  symbol,
  Map<string, Promise<unknown>> | undefined
>;

async function withCommentLock<T>(ref: CommentRef, fn: () => Promise<T>): Promise<T> {
  let locks = lockHolder[LOCKS_KEY];
  if (!locks) {
    locks = new Map();
    lockHolder[LOCKS_KEY] = locks;
  }
  const key = `${ref.videoId}/${ref.sessionId}/${ref.commentId}`;
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const settled = run.catch(() => {});
  locks.set(key, settled);
  try {
    return await run;
  } finally {
    if (locks.get(key) === settled) locks.delete(key);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

// Lookups

export async function resolveToken(token: string): Promise<VideoRecord | null> {
  return findVideoByToken(token);
}

/**
 * The session `sid` of the video behind `token`, or null. Sessions are stored under their
 * video, so a session id that belongs to another video is simply not found here.
 */
async function resolveSession(
  token: string,
  sid: string
): Promise<{ video: VideoRecord; session: SessionRecord } | null> {
  if (!isUuid(sid)) return null;
  const video = await resolveToken(token);
  if (video === null) return null;
  const session = await getSession(video.videoId, sid);
  if (session === null || session.videoId !== video.videoId || session.sessionId !== sid) {
    return null;
  }
  return { video, session };
}

// Sessions

/**
 * Starts a review session on the latest version of the video. Returns null for an unknown
 * token or a video with nothing imported yet. Throws `ReviewInputError` for a bad name.
 */
export async function startSession(
  token: string,
  body: CreateSessionBody
): Promise<CreateSessionResult | null> {
  const video = await resolveToken(token);
  if (video === null || video.latestVersion < 1) return null;

  const raw: unknown = body;
  if (!isDict(raw)) throw new ReviewInputError('Body must be a JSON object.');
  const name = typeof raw.reviewerName === 'string' ? raw.reviewerName.trim() : '';
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
    throw new ReviewInputError(`reviewerName must be 1 to ${MAX_NAME_LENGTH} characters.`);
  }
  const userAgent =
    typeof raw.userAgent === 'string' ? raw.userAgent.slice(0, MAX_USER_AGENT_LENGTH) : '';

  const session = await createSession(video.videoId, video.latestVersion, name, userAgent);
  return { sessionId: session.sessionId, version: session.version };
}

export async function readSession(token: string, sid: string): Promise<GetSessionResult | null> {
  const found = await resolveSession(token, sid);
  if (found === null) return null;
  const { session } = found;
  return {
    sessionId: session.sessionId,
    version: session.version,
    reviewerName: session.reviewerName,
    done: session.doneAt !== null,
  };
}

/** Marks the session as done. Returns false if it does not exist. Safe to call again. */
export async function finishSession(token: string, sid: string): Promise<boolean> {
  const found = await resolveSession(token, sid);
  if (found === null) return false;
  if (found.session.doneAt === null) {
    await saveSession({ ...found.session, doneAt: new Date().toISOString() });
  }
  return true;
}

// Chunks

/**
 * Stores one upload chunk of a comment. Retries are free: a `seq` that is already stored is
 * acknowledged and nothing is rewritten. Chunk 0 carries the comment's meta and creates
 * `meta.json` and `status.json`; later chunks may arrive before it.
 */
export async function receiveChunk(
  token: string,
  sid: string,
  cid: string,
  seq: number,
  form: { audio: Blob; events: CaptureEvent[]; meta?: CommentMeta }
): Promise<{ status: 200 | 404 | 413 | 429 | 400; body: unknown }> {
  const found = await resolveSession(token, sid);
  if (found === null || !isUuid(cid)) return { status: 404, body: NOT_FOUND };
  const { video, session } = found;

  // Counted only for real sessions, so guessed ids cannot fill the limiter.
  const rateKey = `${video.videoId}/${session.sessionId}`;
  if (!allowRequest(rateKey, MAX_CHUNK_REQUESTS_PER_MIN, RATE_WINDOW_MS)) {
    return { status: 429, body: { error: 'too many requests' } };
  }

  if (!Number.isInteger(seq) || seq < 0 || seq >= MAX_CHUNKS_PER_COMMENT) {
    return { status: 400, body: { error: 'invalid chunk number' } };
  }
  if (!(form.audio instanceof Blob)) return { status: 400, body: { error: 'audio is required' } };
  if (form.audio.size > MAX_CHUNK_BYTES) return { status: 413, body: { error: 'chunk too large' } };

  let meta: CommentMeta | null = null;
  if (seq === 0) {
    meta = parseMeta(form.meta, session, cid);
    if (meta === null) {
      return { status: 400, body: { error: 'chunk 0 needs a valid meta' } };
    }
  }
  const events = cleanEvents(form.events);
  const audio = form.audio;
  const ref: CommentRef = { videoId: video.videoId, sessionId: session.sessionId, commentId: cid };
  const dir = commentDir(ref);
  const received = { status: 200, body: { received: seq } } as const;

  return withCommentLock(ref, async () => {
    if (await exists(join(dir, 'chunks', `${seq}.bin`))) return received;

    // Raw captures are never changed once the comment has been handed to the pipeline.
    const status = await readJson<CommentStatus>(statusPath(ref));
    if (status !== null && status.state !== 'receiving') {
      return { status: 400, body: { error: 'comment is already complete' } };
    }
    if ((await storedBytes(dir)) + audio.size > MAX_COMMENT_BYTES) {
      return { status: 413, body: { error: 'comment too large' } };
    }

    if (meta !== null) {
      if ((await readCommentMeta(ref)) === null) await writeCommentMeta(ref, meta);
      if (status === null) await writeJsonAtomic(statusPath(ref), receivingStatus());
    }
    await putChunk(dir, seq, Buffer.from(await audio.arrayBuffer()), events);
    return received;
  });
}

/**
 * Closes a comment once every chunk `0..totalChunks-1` is stored: fills in the meta, marks
 * the comment `queued` and tells the pipeline. Answers 409 with the missing chunk numbers
 * otherwise. Completing a comment that is already past `receiving` changes nothing.
 * Throws `ReviewInputError` for a malformed body.
 */
export async function completeComment(
  token: string,
  sid: string,
  cid: string,
  body: CompleteBody
): Promise<{ status: 200 | 404 | 409; body: CompleteResult | MissingChunksResult | unknown }> {
  const found = await resolveSession(token, sid);
  if (found === null || !isUuid(cid)) return { status: 404, body: NOT_FOUND };
  const done = parseCompleteBody(body);
  const ref: CommentRef = {
    videoId: found.video.videoId,
    sessionId: found.session.sessionId,
    commentId: cid,
  };
  const dir = commentDir(ref);
  const ok: CompleteResult = { ok: true };

  const outcome = await withCommentLock(ref, async () => {
    const status = await readJson<CommentStatus>(statusPath(ref));
    if (status !== null && status.state !== 'receiving') return 'already' as const;

    const missing = await missingChunks(dir, done.totalChunks);
    const meta = await readCommentMeta(ref);
    // Chunk 0 is only ever stored after its meta, so this is belt and braces.
    if (meta === null && !missing.includes(0)) missing.unshift(0);
    if (meta === null || missing.length > 0) return missing;

    const { micLost, ...rest } = done;
    await writeCommentMeta(ref, {
      ...meta,
      ...rest,
      ...(micLost === undefined ? {} : { micLost }),
    });
    await writeJsonAtomic(statusPath(ref), {
      ...(status ?? receivingStatus()),
      state: 'queued',
      updatedAt: new Date().toISOString(),
    } satisfies CommentStatus);
    return 'queued' as const;
  });

  if (outcome === 'already') return { status: 200, body: ok };
  if (outcome !== 'queued') {
    const result: MissingChunksResult = { ok: false, missing: outcome };
    return { status: 409, body: result };
  }
  try {
    notifyCommentComplete(ref);
  } catch (err) {
    // The comment is safely stored as `queued`; the pipeline's startup scan will pick it up.
    console.error('Could not enqueue a completed comment.', ref, err);
  }
  return { status: 200, body: ok };
}
