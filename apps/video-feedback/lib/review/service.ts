import { mkdir, readdir, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MAX_CHUNK_BYTES,
  MAX_CHUNK_REQUESTS_PER_MIN,
  MAX_COMMENT_BYTES,
  MAX_EVENTS_BYTES,
} from '@/lib/constants';
import { config } from '@/lib/config';
import { limits } from '@/lib/limits';
import { mediaKindOf } from '@/lib/media-kind';
import { notifyCommentComplete } from '@/lib/pipeline/enqueue';
import { initialStatus, readStatus, updateStatus } from '@/lib/pipeline/status';
import { missingChunks, putChunk, storedBytes } from '@/lib/storage/chunks';
import { isUuid } from '@/lib/storage/ids';
import { commentDir, sessionsDir } from '@/lib/storage/paths';
import {
  createSession,
  findVideoByToken,
  getSession,
  listComments,
  listSessions,
  listVideos,
  readCommentMeta,
  saveSession,
  writeCommentMeta,
} from '@/lib/storage/repo';
import type {
  CaptureEvent,
  CommentMeta,
  CommentRef,
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

/** A limit was reached. Routes answer with `status`: 413, 429 or 507. */
export class ReviewLimitError extends Error {
  constructor(
    message: string,
    readonly status: 413 | 429 | 507
  ) {
    super(message);
    this.name = 'ReviewLimitError';
  }
}

// Free disk space. DATA_DIR also holds the source videos and every status file, so a full
// disk breaks far more than uploads: new data is refused while there is still room to work.

const DISK_CHECK_EVERY_MS = 5000;
type DiskProbe = () => Promise<number>;
let diskProbe: DiskProbe | null = null;
let diskChecked: { at: number; root: string; free: number } | null = null;

async function freeDiskBytes(): Promise<number> {
  if (diskProbe) return diskProbe();
  const root = config().dataDir;
  const now = Date.now();
  if (diskChecked && diskChecked.root === root && now - diskChecked.at < DISK_CHECK_EVERY_MS) {
    return diskChecked.free;
  }
  let free = Number.POSITIVE_INFINITY;
  try {
    await mkdir(root, { recursive: true });
    const fs = await statfs(root);
    free = fs.bavail * fs.bsize;
  } catch {
    // If the space cannot be read, the write itself will say what is wrong.
  }
  diskChecked = { at: now, root, free };
  return free;
}

async function diskIsLow(): Promise<boolean> {
  return (await freeDiskBytes()) < limits.minFreeDiskBytes;
}

/** Replaces the free-space reading. Pass null to read the real disk again. */
export function setFreeDiskProbeForTests(probe: DiskProbe | null): void {
  diskProbe = probe;
  diskChecked = null;
}

// Bytes stored per session since the server started. Held in memory like the rate limits: it
// bounds what one session can write in a run without re-reading its folders on every chunk.

const SESSION_BYTES_KEY = Symbol.for('video-feedback.sessionBytes');
const bytesHolder = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;

function sessionBytes(): Map<string, number> {
  let m = bytesHolder[SESSION_BYTES_KEY];
  if (!m) {
    m = new Map();
    bytesHolder[SESSION_BYTES_KEY] = m;
  }
  return m;
}

export function resetSessionBytesForTests(): void {
  sessionBytes().clear();
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
 * fields the client owns at that point are taken; ids and version come from the session, and
 * `mediaKind` from the version record. It is written for a Talkie version only, so the meta of
 * a comment on an MP4 is what it always was.
 */
function parseMeta(
  v: unknown,
  video: VideoRecord,
  session: SessionRecord,
  commentId: string
): CommentMeta | null {
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
  const record = video.versions.find((r) => r.version === session.version);
  const talkie = record !== undefined && mediaKindOf(record) === 'talkie';
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
    ...(talkie ? { mediaKind: 'talkie' as const } : {}),
  };
}

/** A scene id comes from the film; anything longer than this is not one. */
const MAX_SCENE_ID_LENGTH = 200;
const SEEK_VIA: ReadonlySet<unknown> = new Set(['scrollbar', 'key']);
const ZOOM_STATES: ReadonlySet<unknown> = new Set(['start', 'end']);
const VISIBILITY_STATES: ReadonlySet<unknown> = new Set(['hidden', 'visible', 'blur', 'focus']);

/**
 * Copies the known fields of one capture event, or returns null if it is not a valid event of
 * its type. Nothing else the client put on the object is kept, so the size of a stored event
 * is bounded by its type.
 */
function parseEvent(e: unknown): CaptureEvent | null {
  if (!isDict(e) || !isFiniteNumber(e.t)) return null;
  const t = e.t;
  switch (e.type) {
    case 'pointer':
    case 'click': {
      const { x, y, inside, vt, button, zoomed } = e;
      if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(vt)) return null;
      if (typeof inside !== 'boolean') return null;
      const zoom = typeof zoomed === 'boolean' ? { zoomed } : {};
      if (e.type === 'pointer') return { t, type: 'pointer', x, y, inside, vt, ...zoom };
      if (!isFiniteNumber(button)) return null;
      return { t, type: 'click', x, y, inside, vt, button, ...zoom };
    }
    case 'seek': {
      const { from, to, via } = e;
      if (!isFiniteNumber(from) || !isFiniteNumber(to) || !SEEK_VIA.has(via)) return null;
      return { t, type: 'seek', from, to, via: via as 'scrollbar' | 'key' };
    }
    case 'zoom': {
      const { state, scale, originX, originY } = e;
      if (!ZOOM_STATES.has(state) || !isFiniteNumber(scale)) return null;
      if (!isFiniteNumber(originX) || !isFiniteNumber(originY)) return null;
      return { t, type: 'zoom', state: state as 'start' | 'end', scale, originX, originY };
    }
    case 'zoomPan': {
      const { originX, originY } = e;
      if (!isFiniteNumber(originX) || !isFiniteNumber(originY)) return null;
      return { t, type: 'zoomPan', originX, originY };
    }
    case 'visibility': {
      if (!VISIBILITY_STATES.has(e.state)) return null;
      return { t, type: 'visibility', state: e.state as 'hidden' | 'visible' | 'blur' | 'focus' };
    }
    case 'layout': {
      const { containerWidth, containerHeight, fullscreen } = e;
      const contentRect = parseRect(e.contentRect);
      if (contentRect === null || typeof fullscreen !== 'boolean') return null;
      if (!isFiniteNumber(containerWidth) || !isFiniteNumber(containerHeight)) return null;
      return { t, type: 'layout', contentRect, containerWidth, containerHeight, fullscreen };
    }
    case 'sceneWarning': {
      const { sceneId } = e;
      if (typeof sceneId !== 'string' || sceneId === '') return null;
      if (sceneId.length > MAX_SCENE_ID_LENGTH) return null;
      return { t, type: 'sceneWarning', sceneId };
    }
    default:
      return null;
  }
}

/** Keeps the valid events of the first 20,000 entries, rebuilt field by field. Never throws. */
function cleanEvents(v: unknown): CaptureEvent[] {
  if (!Array.isArray(v)) return [];
  const out: CaptureEvent[] = [];
  for (const e of v.slice(0, MAX_EVENTS_PER_CHUNK)) {
    const event = parseEvent(e);
    if (event !== null) out.push(event);
  }
  return out;
}

// Event batches count toward the size limits like audio does. The two bytes of the array
// brackets are not counted, so a chunk with no events costs exactly its audio.

const EMPTY_BATCH_BYTES = 2;
const EVENTS_FILE_RE = /^\d+\.json$/;

function eventsBytes(events: CaptureEvent[]): number {
  return Buffer.byteLength(JSON.stringify(events)) - EMPTY_BATCH_BYTES;
}

/** Counted bytes of the event batches stored for a comment, leaving out the one for `seq`. */
async function storedEventsBytes(dir: string, seq: number): Promise<number> {
  const eventsDir = join(dir, 'events');
  let names: string[];
  try {
    names = await readdir(eventsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  // A batch left behind by a failed write of this same chunk is not charged twice.
  const files = names.filter((n) => EVENTS_FILE_RE.test(n) && n !== `${seq}.json`);
  const sizes = await Promise.all(files.map(async (n) => (await stat(join(eventsDir, n))).size));
  return sizes.reduce((sum, n) => sum + Math.max(0, n - EMPTY_BATCH_BYTES), 0);
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
  // The audio is cut to the same length when it is assembled, so a longer claim is not kept.
  const duration = Math.min(durationMs, limits.commentDurationMs);
  const player = parsePlayer(v.player);
  if (player === null) throw new ReviewInputError('player is missing or not valid.');
  if (micLost !== undefined && typeof micLost !== 'boolean') {
    throw new ReviewInputError('micLost must be true or false.');
  }
  return {
    totalChunks,
    endedAt,
    durationMs: duration,
    player,
    ...(micLost === undefined ? {} : { micLost }),
  };
}

// Comment status. The pipeline owns this file once a comment is queued; the reviewer API only
// creates it and moves it from `receiving` to `queued`, through the pipeline's own helpers so
// the shape always matches.

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

const HOUR_MS = 3_600_000;
// Control characters, line and paragraph separators, and the bidirectional overrides that can
// reorder the text around a name.
const NAME_JUNK_RE = /[\p{Cc}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069]+/gu;

/**
 * A reviewer name as one line of plain text. The name is printed into `feedback.md`, which a
 * model reads as trusted structure, so it must not be able to start a line of its own.
 */
function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(NAME_JUNK_RE, ' ').replace(/\s+/g, ' ').trim();
}

async function countDirs(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).length;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
}

/**
 * Starts a review session on the latest version of the video. Returns null for an unknown
 * token or a video with nothing imported yet. Throws `ReviewInputError` for a bad name.
 */
export async function startSession(
  token: string,
  body: CreateSessionBody,
  client: { ip?: string | null } = {}
): Promise<CreateSessionResult | null> {
  const video = await resolveToken(token);
  if (video === null || video.latestVersion < 1) return null;

  const raw: unknown = body;
  if (!isDict(raw)) throw new ReviewInputError('Body must be a JSON object.');
  const name = cleanName(raw.reviewerName);
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
    throw new ReviewInputError(`reviewerName must be 1 to ${MAX_NAME_LENGTH} characters.`);
  }
  const userAgent =
    typeof raw.userAgent === 'string' ? raw.userAgent.slice(0, MAX_USER_AGENT_LENGTH) : '';

  // A leaked link must not be a way to fill the disk with sessions. Checked only once the
  // request is known to be a real one, so junk requests cannot use up the allowance.
  const tooMany = new ReviewLimitError('Too many new sessions. Try again later.', 429);
  const ip = typeof client.ip === 'string' ? client.ip.trim().slice(0, 64) : '';
  if (ip !== '' && !allowRequest(`start-ip:${ip}`, limits.sessionsPerIpPerHour, HOUR_MS)) {
    throw tooMany;
  }
  if (!allowRequest(`start:${video.videoId}`, limits.sessionsPerTokenPerHour, HOUR_MS)) {
    throw tooMany;
  }
  if ((await countDirs(sessionsDir(video.videoId))) >= limits.sessionsPerVideo) throw tooMany;
  if (await diskIsLow()) throw new ReviewLimitError('The server is out of space.', 507);

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

export type ChunkForm = { audio: Blob; events: CaptureEvent[]; meta?: CommentMeta };
export type ChunkReply = { status: 200 | 404 | 413 | 429 | 400 | 507; body: unknown };
/** Either the answer to send straight away, or the way to store the chunk once it is read. */
export type ChunkAdmission =
  { ok: false; reply: ChunkReply } | { ok: true; store: (form: ChunkForm) => Promise<ChunkReply> };

/**
 * Decides whether a chunk upload may go ahead, from its URL alone: the token, session and
 * comment id must be real, the session within its rate limit and `seq` a valid number.
 * Routes call this before they read the request body, so a refused request costs no more
 * than a lookup. Each call counts as one request against the session's limit.
 */
export async function admitChunk(
  token: string,
  sid: string,
  cid: string,
  seq: number
): Promise<ChunkAdmission> {
  const found = await resolveSession(token, sid);
  if (found === null || !isUuid(cid)) return { ok: false, reply: { status: 404, body: NOT_FOUND } };
  const { video, session } = found;

  // Counted only for real sessions, so guessed ids cannot fill the limiter.
  const rateKey = `${video.videoId}/${session.sessionId}`;
  const tokenKey = `chunks:${video.videoId}`;
  if (
    !allowRequest(rateKey, MAX_CHUNK_REQUESTS_PER_MIN, RATE_WINDOW_MS) ||
    !allowRequest(tokenKey, limits.chunkRequestsPerMinPerToken, RATE_WINDOW_MS)
  ) {
    return { ok: false, reply: { status: 429, body: { error: 'too many requests' } } };
  }
  // 507 is retried by the browser, which keeps the audio until there is room again.
  if (await diskIsLow()) {
    return { ok: false, reply: { status: 507, body: { error: 'server storage is full' } } };
  }
  if (!Number.isInteger(seq) || seq < 0 || seq >= MAX_CHUNKS_PER_COMMENT) {
    return { ok: false, reply: { status: 400, body: { error: 'invalid chunk number' } } };
  }
  const ref: CommentRef = { videoId: video.videoId, sessionId: session.sessionId, commentId: cid };
  return { ok: true, store: (form) => storeChunk(video, session, ref, seq, form) };
}

async function storeChunk(
  video: VideoRecord,
  session: SessionRecord,
  ref: CommentRef,
  seq: number,
  form: ChunkForm
): Promise<ChunkReply> {
  const tooLarge = { status: 413, body: { error: 'chunk too large' } } as const;
  if (!(form.audio instanceof Blob)) return { status: 400, body: { error: 'audio is required' } };
  if (form.audio.size > MAX_CHUNK_BYTES) return tooLarge;

  let meta: CommentMeta | null = null;
  if (seq === 0) {
    meta = parseMeta(form.meta, video, session, ref.commentId);
    if (meta === null) {
      return { status: 400, body: { error: 'chunk 0 needs a valid meta' } };
    }
  }
  const events = cleanEvents(form.events);
  const audio = form.audio;
  // Audio and events share the limits: what is stored for a chunk is both of them.
  const eventBytes = eventsBytes(events);
  if (eventBytes > MAX_EVENTS_BYTES) return tooLarge;
  const chunkBytes = audio.size + eventBytes;
  if (chunkBytes > MAX_CHUNK_BYTES) return tooLarge;

  const dir = commentDir(ref);
  const received = { status: 200, body: { received: seq } } as const;

  return withCommentLock(ref, async () => {
    if (await exists(join(dir, 'chunks', `${seq}.bin`))) return received;

    // Raw captures are never changed once the comment has been handed to the pipeline.
    const status = await readStatus(ref);
    if (status !== null && status.state !== 'receiving') {
      return { status: 400, body: { error: 'comment is already complete' } };
    }
    const stored = (await storedBytes(dir)) + (await storedEventsBytes(dir, seq));
    if (stored + chunkBytes > MAX_COMMENT_BYTES) {
      return { status: 413, body: { error: 'comment too large' } };
    }
    const sessionKey = `${ref.videoId}/${ref.sessionId}`;
    const sessionTotal = sessionBytes().get(sessionKey) ?? 0;
    if (sessionTotal + chunkBytes > limits.sessionBytes) {
      return { status: 413, body: { error: 'session too large' } };
    }
    if (!(await exists(dir))) {
      const comments = await listComments(ref.videoId, ref.sessionId);
      if (comments.length >= limits.commentsPerSession) {
        return { status: 413, body: { error: 'too many comments' } };
      }
    }

    if (meta !== null) {
      if ((await readCommentMeta(ref)) === null) await writeCommentMeta(ref, meta);
      if (status === null) await updateStatus(ref, initialStatus());
    }
    await putChunk(dir, seq, Buffer.from(await audio.arrayBuffer()), events);
    sessionBytes().set(sessionKey, sessionTotal + chunkBytes);
    return received;
  });
}

/**
 * Stores one upload chunk of a comment. Retries are free: a `seq` that is already stored is
 * acknowledged and nothing is rewritten. Chunk 0 carries the comment's meta and creates
 * `meta.json` and `status.json`; later chunks may arrive before it.
 *
 * Audio and events together are held to `MAX_CHUNK_BYTES` per chunk and `MAX_COMMENT_BYTES`
 * per comment, and the events alone to `MAX_EVENTS_BYTES`.
 */
export async function receiveChunk(
  token: string,
  sid: string,
  cid: string,
  seq: number,
  form: ChunkForm
): Promise<ChunkReply> {
  const admission = await admitChunk(token, sid, cid, seq);
  return admission.ok ? admission.store(form) : admission.reply;
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
    const status = await readStatus(ref);
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
    await updateStatus(ref, { ...(status ?? initialStatus()), state: 'queued' });
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

// Comments nobody completed

const CHUNK_BIN_RE = /^(\d+)\.bin$/;

/** The stored chunk numbers of a comment and when the newest of them was written. */
async function chunkState(dir: string): Promise<{ seqs: Set<number>; newest: number }> {
  const seqs = new Set<number>();
  let newest = 0;
  let names: string[] = [];
  try {
    names = await readdir(join(dir, 'chunks'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  for (const name of names) {
    const m = CHUNK_BIN_RE.exec(name);
    if (!m) continue;
    seqs.add(Number(m[1]));
    newest = Math.max(newest, (await stat(join(dir, 'chunks', name))).mtimeMs);
  }
  return { seqs, newest };
}

/**
 * Finishes comments whose upload stopped without a complete call: the reviewer closed the tab
 * mid-comment and never came back, or their browser lost the call. Without this such a comment
 * stays `receiving` for ever and its audio is never transcribed or exported.
 *
 * A comment counts as stale when it is still `receiving` and nothing has been written to it
 * for `limits.staleReceivingMs`. It is closed with the unbroken run of chunks from 0 and
 * handed to the pipeline. One with no usable audio at all is marked `failed`, so the admin
 * page shows it. Returns the comments that were queued.
 */
export async function finaliseStaleComments(now: number = Date.now()): Promise<CommentRef[]> {
  const queued: CommentRef[] = [];
  for (const video of await listVideos()) {
    for (const session of await listSessions(video.videoId)) {
      for (const ref of await listComments(video.videoId, session.sessionId)) {
        try {
          if (await finaliseIfStale(ref, now)) queued.push(ref);
        } catch (err) {
          // One unreadable comment must not stop the sweep.
          console.error('Could not finish a stale comment.', ref, err);
        }
      }
    }
  }
  for (const ref of queued) {
    try {
      notifyCommentComplete(ref);
    } catch (err) {
      console.error('Could not enqueue a finished stale comment.', ref, err);
    }
  }
  return queued;
}

async function finaliseIfStale(ref: CommentRef, now: number): Promise<boolean> {
  const dir = commentDir(ref);
  const isStale = async (): Promise<{ seqs: Set<number>; newest: number } | null> => {
    const status = await readStatus(ref);
    if (status === null || status.state !== 'receiving') return null;
    const chunks = await chunkState(dir);
    const last = Math.max(chunks.newest, Date.parse(status.updatedAt) || 0);
    return now - last >= limits.staleReceivingMs ? chunks : null;
  };
  // Looked at once without the lock, so a sweep over many comments holds up no upload.
  if ((await isStale()) === null) return false;

  return withCommentLock(ref, async () => {
    const chunks = await isStale();
    if (chunks === null) return false;
    const meta = await readCommentMeta(ref);
    let total = 0;
    while (chunks.seqs.has(total)) total++;
    if (meta === null || total === 0) {
      await updateStatus(ref, {
        state: 'failed',
        error: 'The upload stopped before any audio arrived.',
      });
      return false;
    }
    const endedMs = chunks.newest || now;
    const startedMs = Date.parse(meta.startedAt);
    const lasted = Number.isFinite(startedMs) ? Math.max(0, endedMs - startedMs) : 0;
    await writeCommentMeta(ref, {
      ...meta,
      totalChunks: total,
      endedAt: new Date(endedMs).toISOString(),
      durationMs: Math.min(lasted, limits.commentDurationMs),
    });
    await updateStatus(ref, { state: 'queued' });
    return true;
  });
}
