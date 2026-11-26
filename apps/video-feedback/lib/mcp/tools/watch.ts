import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { buildExportModel, type ExportComment } from '@/lib/export/model';
import { FILES } from '@/lib/pipeline/steps/types';
import { isUuid } from '@/lib/storage/ids';
import { commentsDir, ID_RE, sessionDir, sessionsDir, videosDir } from '@/lib/storage/paths';
import { getVideo } from '@/lib/storage/repo';
import {
  ANSWER_TEXT_BUDGET,
  commentText,
  IMAGE_MODE_DESCRIPTION,
  IMAGE_MODES,
  type ImageMode,
  MAX_IMAGES_PER_ANSWER,
  oneLine,
  packComments,
} from '../comments';
import { requireVideo, VIDEO_ID_PROP } from '../common';
import {
  type Content,
  type Tool,
  type ToolContext,
  type ToolResult,
  textContent,
  ToolError,
} from '../types';
import {
  acknowledge,
  createWatch,
  formatCursor,
  parseCursor,
  readWatch,
  saveWatch,
  touch,
  type WatchRecord,
  withWatchLock,
} from '../watches';

// wait_for_feedback: blocks until comments finish processing or a reviewer presses Done, then
// returns them, with a cursor that makes sure nothing is missed or repeated (see watches.ts).
//
// The server it runs on is a weak shared machine, so waiting is cheap: every few seconds the
// comment and session files are stat'ed, and a file is only read again when its size, time or
// inode changed. Nothing is read while nothing changes, and every caller watching the same
// thing shares one scan.

/**
 * Most comments with words in one answer. Claude Code cuts an answer past about 25k tokens and
 * the cut part is lost, so few comments per answer, and the text budget may stop it sooner.
 * The rest come at once on the next call.
 */
export const MAX_COMMENTS = 10;
/** Dones and empty pauses one answer reports at most: each is a line in the header. */
export const MAX_OTHER_EVENTS = 40;

interface Timing {
  /** How often the files are checked while waiting, and how long one scan is reused. */
  pollMs: number;
  /** How long to wait for the rest of a burst when more comments are still processing. */
  burstMs: number;
  /** How often a progress line is sent while waiting. */
  progressMs: number;
  /** One second of timeoutSeconds. Shortened in tests. */
  secondMs: number;
}

const DEFAULT_TIMING: Timing = {
  pollMs: 3000,
  burstMs: 2000,
  progressMs: 60_000,
  secondMs: 1000,
};
let timing: Timing = { ...DEFAULT_TIMING };

/** For tests: shorter waits. Returns a function that puts the real ones back. */
export function setWatchTimingForTests(t: Partial<Timing>): () => void {
  timing = { ...DEFAULT_TIMING, ...t };
  // Each test has its own data folder: a scan of the last one must not be reused.
  scanners.clear();
  return () => {
    timing = { ...DEFAULT_TIMING };
    scanners.clear();
  };
}

// The scan: what has happened so far

interface CommentEvent {
  kind: 'comment';
  key: string;
  videoId: string;
  sessionId: string;
  commentId: string;
  /** The finished state: an empty pause is only counted, never shown in full. */
  state: string;
  /** The name the reviewer typed, from their session. Untrusted. */
  reviewerName: string;
}

interface SessionEvent {
  kind: 'session';
  key: string;
  videoId: string;
  sessionId: string;
  reviewerName: string;
  version: number;
}

type WatchEvent = CommentEvent | SessionEvent;

interface Scan {
  /** Every event so far, by key, in a stable order (video, session, comment). */
  events: Map<string, WatchEvent>;
  /** Comments queued or being processed: they will be events soon. */
  processing: number;
  /** Comments still being recorded or uploaded by a reviewer. */
  recording: number;
}

const FINISHED = new Set(['done', 'empty', 'failed']);

interface StatusFacts {
  state: string;
  hasMeta: boolean;
  attempts: number;
}

interface SessionFacts {
  doneAt: string | null;
  reviewerName: string;
  version: number;
}

// What was read from each status.json and session.json, kept with the file's stat mark.
// Every JSON write here replaces the file (a new inode), so an unchanged mark means an
// unchanged file. Only the few fields the scan needs are kept.
const facts = new Map<string, { mark: string; value: unknown }>();
const FACTS_MAX = 50_000;

async function readCached<T>(path: string, parse: (raw: unknown) => Promise<T | null>) {
  let mark: string;
  try {
    const s = await stat(path);
    mark = `${s.ino}:${s.size}:${s.mtimeMs}`;
  } catch {
    facts.delete(path);
    return null;
  }
  const hit = facts.get(path);
  if (hit && hit.mark === mark) return hit.value as T | null;
  let value: T | null = null;
  try {
    value = await parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    // Unreadable or half-written by hand: treated as missing until it changes.
  }
  if (facts.size >= FACTS_MAX) facts.clear();
  facts.set(path, { mark, value });
  return value;
}

async function dirNames(dir: string, keep: (name: string) => boolean): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && keep(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function scanVideo(videoId: string, scan: Scan): Promise<void> {
  for (const sessionId of await dirNames(sessionsDir(videoId), isUuid)) {
    const session = await readCached<SessionFacts>(
      join(sessionDir(videoId, sessionId), 'session.json'),
      async (raw) => {
        const s = raw as Partial<SessionFacts> | null;
        if (s === null || typeof s !== 'object') return null;
        return {
          doneAt: typeof s.doneAt === 'string' ? s.doneAt : null,
          reviewerName: typeof s.reviewerName === 'string' ? s.reviewerName : 'A reviewer',
          version: typeof s.version === 'number' ? s.version : 0,
        };
      }
    );
    const reviewerName = session?.reviewerName ?? 'A reviewer';
    const comments = commentsDir(videoId, sessionId);
    for (const commentId of await dirNames(comments, isUuid)) {
      const dir = join(comments, commentId);
      const status = await readCached<StatusFacts>(join(dir, FILES.status), async (raw) => {
        const s = raw as { state?: unknown; attempts?: unknown } | null;
        if (typeof s?.state !== 'string') return null;
        return {
          state: s.state,
          // The export leaves out a comment without its meta, so it is not an event without one.
          hasMeta: await exists(join(dir, 'meta.json')),
          attempts: typeof s.attempts === 'number' ? s.attempts : 0,
        };
      });
      if (status === null) continue;
      if (FINISHED.has(status.state) && status.hasMeta) {
        // Every full processing run counts one more attempt (a clip-only run does not), so a
        // reprocessed comment is a new event and is reported again, while a clip finishing
        // later is not.
        const key = `c:${commentId}:${status.attempts}`;
        scan.events.set(key, {
          kind: 'comment',
          key,
          videoId,
          sessionId,
          commentId,
          state: status.state,
          reviewerName,
        });
      } else if (status.state === 'queued' || status.state === 'processing') {
        scan.processing += 1;
      } else if (status.state === 'receiving') {
        scan.recording += 1;
      }
    }
    if (session?.doneAt) {
      const key = `s:${sessionId}`;
      scan.events.set(key, {
        kind: 'session',
        key,
        videoId,
        sessionId,
        reviewerName: session.reviewerName,
        version: session.version,
      });
    }
  }
}

// Counted so a test can check that waiters share scans and that scans never overlap.
const scanStats = { runs: 0, running: 0, maxRunning: 0 };

/** For tests: how many scans ran, and the most that ever ran at once. Resets the count. */
export function takeScanStatsForTests(): { runs: number; maxRunning: number } {
  const out = { runs: scanStats.runs, maxRunning: scanStats.maxRunning };
  scanStats.runs = 0;
  scanStats.maxRunning = scanStats.running;
  return out;
}

async function scanNow(videoId: string | null): Promise<Scan> {
  scanStats.runs += 1;
  scanStats.running += 1;
  scanStats.maxRunning = Math.max(scanStats.maxRunning, scanStats.running);
  try {
    const scan: Scan = { events: new Map(), processing: 0, recording: 0 };
    const ids = videoId === null ? await dirNames(videosDir(), (n) => ID_RE.test(n)) : [videoId];
    for (const id of ids) await scanVideo(id, scan);
    return scan;
  } finally {
    scanStats.running -= 1;
  }
}

// One scanner per thing watched (one video, or every video), shared by every caller waiting on
// it: however many agents wait, the files are walked at most once per poll interval, and never
// by two scans at once. A scan's age counts from when it finished. The Scan it gives is shared,
// so nobody may change it.
interface Scanner {
  running: { startedAt: number; done: Promise<Scan> } | null;
  last: { startedAt: number; finishedAt: number; scan: Scan } | null;
}
const scanners = new Map<string, Scanner>();

/**
 * What has happened so far. `freshAfter` asks for a scan begun no earlier than that time, for
 * a caller that has just waited for the files to change.
 */
async function scanEvents(videoId: string | null, freshAfter = 0): Promise<Scan> {
  const key = videoId ?? '*';
  let s = scanners.get(key);
  if (!s) {
    s = { running: null, last: null };
    scanners.set(key, s);
  }
  for (;;) {
    if (s.running) {
      if (s.running.startedAt >= freshAfter) return s.running.done;
      // Too old for this caller: let it finish, then start one (no two scans at once).
      await s.running.done.catch(() => {});
      continue;
    }
    const last = s.last;
    if (last && last.startedAt >= freshAfter && Date.now() - last.finishedAt < timing.pollMs) {
      return last.scan;
    }
    const scanner = s;
    const startedAt = Date.now();
    const done = scanNow(videoId).then((scan) => {
      scanner.last = { startedAt, finishedAt: Date.now(), scan };
      return scan;
    });
    const running = { startedAt, done };
    scanner.running = running;
    done
      .catch(() => {})
      .finally(() => {
        if (scanner.running === running) scanner.running = null;
      });
    return done;
  }
}

// Answers

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const cursorLine = (cursor: string) =>
  `Cursor: ${cursor} (pass this to the next wait_for_feedback call)`;

/** Reviewer names as they typed them, quoted, with a count where one sent more than one. */
function names(events: { reviewerName: string }[]): string {
  const counts = new Map<string, number>();
  for (const e of events) {
    const name = JSON.stringify(oneLine(e.reviewerName));
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const list = [...counts].map(([name, n]) => (n > 1 ? `${name} x${n}` : name)).join(', ');
  return `reviewer names as typed: ${list}`;
}

function processingLines(scan: Scan): string[] {
  const lines: string[] = [];
  if (scan.processing > 0) {
    lines.push(
      `Still processing: ${plural(scan.processing, 'comment')}. They come in a later call.`
    );
  } else {
    lines.push('Nothing is processing right now.');
  }
  if (scan.recording > 0) {
    lines.push(
      `${plural(scan.recording, 'comment')} ${scan.recording === 1 ? 'is' : 'are'} being recorded or uploaded by a reviewer right now.`
    );
  }
  return lines;
}

function nothingYet(cursor: string, scan: Scan, seconds: number): ToolResult {
  return {
    content: [
      textContent(
        [
          cursorLine(cursor),
          `Nothing new yet: no comment finished processing and no reviewer pressed Done in ${seconds} s.`,
          ...processingLines(scan),
          'Call wait_for_feedback again with this cursor to keep waiting.',
        ].join('\n')
      ),
    ],
  };
}

function watchStarted(cursor: string, scan: Scan, fromStart: boolean): ToolResult {
  const what = fromStart
    ? 'Watch started from the start: nothing has finished yet.'
    : 'Watch started from now: nothing yet. Feedback that finishes from here on comes to this cursor.';
  return {
    content: [
      textContent(
        [
          cursorLine(cursor),
          what,
          ...processingLines(scan),
          'Call wait_for_feedback again with this cursor to wait for feedback.',
        ].join('\n')
      ),
    ],
  };
}

function stopped(cursor: string, superseded: boolean): ToolResult {
  const why = superseded
    ? 'Stopped: a newer wait_for_feedback call on this watch took over, and nothing was delivered here. Only one caller may wait on a cursor at a time: the newer call carries on and gives the next cursor. If you are a second caller (another agent or subagent), start your own watch instead by calling without a cursor.'
    : 'Stopped: the call was cancelled. Nothing was delivered.';
  return { content: [textContent(`${cursorLine(cursor)}\n${why}`)] };
}

interface VideoGroup {
  videoId: string;
  comments: CommentEvent[];
  empties: CommentEvent[];
  sessions: SessionEvent[];
}

const PENDING_STATES = new Set(['queued', 'processing', 'receiving']);

interface Prepared {
  /** The keys of every event this answer carries: only these may be counted as delivered. */
  keys: string[];
  render(cursor: string): ToolResult;
}

/**
 * Builds an answer from the events not yet delivered: every Done and empty pause, and as many
 * comments with words as fit (at most MAX_COMMENTS, and within the text and image budget of
 * packComments). The rest stay undelivered, and the next call gives them at once.
 */
async function prepare(
  fresh: WatchEvent[],
  scan: Scan,
  ctx: ToolContext,
  images: ImageMode
): Promise<Prepared> {
  const said = fresh.filter((e): e is CommentEvent => e.kind === 'comment' && e.state !== 'empty');
  const wantedSaid = new Set(said.slice(0, MAX_COMMENTS).map((e) => e.key));
  // Dones and empty pauses are a line each; a backlog of hundreds would outgrow the answer.
  const others = fresh.filter((e) => e.kind === 'session' || e.state === 'empty');
  const wantedOther = new Set(others.slice(0, MAX_OTHER_EVENTS).map((e) => e.key));
  const groups = new Map<string, VideoGroup>();
  for (const e of fresh) {
    if (e.kind === 'comment' && e.state !== 'empty' && !wantedSaid.has(e.key)) continue;
    if ((e.kind === 'session' || e.state === 'empty') && !wantedOther.has(e.key)) continue;
    let g = groups.get(e.videoId);
    if (!g) {
      g = { videoId: e.videoId, comments: [], empties: [], sessions: [] };
      groups.set(e.videoId, g);
    }
    if (e.kind === 'session') g.sessions.push(e);
    else if (e.state === 'empty') g.empties.push(e);
    else g.comments.push(e);
  }

  const keys: string[] = [];
  const lines: string[] = [];
  const texts: Content[] = [];
  const stills: Content[] = [];
  let textLeft = ANSWER_TEXT_BUDGET;
  let imagesLeft = MAX_IMAGES_PER_ANSWER;
  let imagesLeftOut = 0;
  let nSaid = 0;
  let nEmpty = 0;
  let nDone = 0;

  for (const g of groups.values()) {
    const video = await getVideo(g.videoId).catch(() => null);
    const videoTitle = oneLine(video?.title ?? g.videoId);
    const title = `"${videoTitle}" (${g.videoId})`;
    let all: ExportComment[] = [];
    if (g.comments.length > 0 || g.sessions.length > 0) {
      try {
        const model = await buildExportModel(
          g.videoId,
          { version: 'all', clips: false, since: null, partial: true },
          new Date()
        );
        if (!('pending' in model)) all = model.comments;
      } catch {
        // The video or its versions are gone: the events are still reported, without detail.
      }
    }

    // Comments with words, as many as fit. One that cannot be read is still reported (by id),
    // since there is nothing more to show of it.
    const byId = new Map(all.map((c) => [c.commentId, c]));
    const found: ExportComment[] = [];
    const missing: CommentEvent[] = [];
    for (const e of g.comments) {
      const c = byId.get(e.commentId);
      if (c) found.push(c);
      else missing.push(e);
    }
    const format = { videoId: g.videoId, baseUrl: ctx.baseUrl, images };
    let included: ExportComment[] = [];
    // packComments always takes the first comment: only let it when the answer has room left.
    const room =
      found.length > 0 &&
      (textLeft === ANSWER_TEXT_BUDGET || commentText(found[0], format).length <= textLeft);
    if (room) {
      const packed = await packComments(found, format, {
        textBudget: textLeft,
        maxImages: imagesLeft,
      });
      included = packed.included;
      texts.push(textContent(`# ${title}`), ...packed.texts);
      for (const t of packed.texts) if (t.type === 'text') textLeft -= t.text.length;
      stills.push(...packed.images);
      imagesLeft -= packed.imagesShown;
      imagesLeftOut += packed.imagesLeftOut;
    }
    const shown = new Set(included.map((c) => c.commentId));
    const givenEvents = g.comments.filter((e) => shown.has(e.commentId) || missing.includes(e));
    keys.push(...givenEvents.map((e) => e.key));
    nSaid += givenEvents.length;

    if (givenEvents.length > 0) {
      lines.push(
        `${title}: ${plural(givenEvents.length, 'new comment')} (${names(givenEvents)}). Ids: ${givenEvents.map((e) => e.commentId).join(', ')}.`
      );
    }
    if (g.empties.length > 0) {
      keys.push(...g.empties.map((e) => e.key));
      nEmpty += g.empties.length;
      lines.push(
        `Empty pauses on ${title}: ${g.empties.length} (${names(g.empties)}): they paused but said nothing, so there is nothing more to show. Ids: ${g.empties.map((e) => e.commentId).join(', ')}.`
      );
    }
    for (const s of g.sessions) {
      keys.push(s.key);
      nDone += 1;
      const theirs = all.filter((c) => c.sessionId === s.sessionId);
      const pending = theirs.filter((c) => PENDING_STATES.has(c.state)).length;
      let line = `The reviewer who typed the name ${JSON.stringify(oneLine(s.reviewerName))} pressed Done on ${videoTitle} v${s.version} (${g.videoId}): their review is complete (${plural(theirs.length, 'comment')}).`;
      if (pending > 0) line += ` ${pending} of them still processing: they come in a later call.`;
      lines.push(line);
    }
    for (const e of missing) {
      lines.push(
        `Comment ${e.commentId} on ${g.videoId} finished but could not be read just now: get_comment may show it.`
      );
    }
  }

  const arrived: string[] = [];
  if (nSaid > 0) arrived.push(plural(nSaid, 'comment'));
  if (nEmpty > 0) arrived.push(plural(nEmpty, 'empty pause'));
  if (nDone > 0)
    arrived.push(`${plural(nDone, 'reviewer')} pressed Done (their review is complete)`);
  const more = said.length - nSaid;
  const tail: string[] = [];
  const moreOther = others.length - wantedOther.size;
  if (moreOther > 0) {
    tail.push(
      `${plural(moreOther, 'more Done or empty pause', 'more Dones and empty pauses')} did not fit in this answer: call again with this cursor and they come at once.`
    );
  }
  if (more > 0) {
    tail.push(
      `${plural(more, 'more comment')} ${more === 1 ? 'is' : 'are'} ready but did not fit in this answer: call again with this cursor and they come at once.`
    );
  }
  tail.push(...processingLines(scan));
  if (imagesLeftOut > 0) {
    tail.push(
      `${plural(imagesLeftOut, 'still')} left out to keep this answer small (at most ${MAX_IMAGES_PER_ANSWER} images): get_comment with a comment id gets its stills.`
    );
  }
  tail.push('Call wait_for_feedback again with this cursor for the next feedback.');

  return {
    keys,
    render: (cursor) => {
      const header = [cursorLine(cursor), `Arrived: ${arrived.join(', and ')}.`, ...lines, ...tail];
      // Text before images: if a client ever cuts the answer, it cuts stills, not words.
      return { content: [textContent(header.join('\n')), ...texts, ...stills] };
    },
  };
}

// Waiting

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

const UNKNOWN_CURSOR =
  'That cursor is not one this server knows (a watch is forgotten after 30 days unused). Call wait_for_feedback without a cursor: from "now" for feedback from here on, or from "start" for everything finished so far.';

// The call waiting on each watch. A newer call on the same watch stops it: its client has
// most likely gone, and an agent only ever needs one wait running per watch.
const waiting = new Map<string, AbortController>();

/** Opens the watch a cursor names, acknowledging what that cursor's answer carried. */
async function openWatch(
  cursorArg: unknown,
  videoId: string | undefined
): Promise<{ watch: WatchRecord; seq: number }> {
  const parsed = parseCursor(String(cursorArg));
  if (parsed === null) throw new ToolError(UNKNOWN_CURSOR);
  const watch = await withWatchLock(parsed.watchId, async () => {
    const w = await readWatch(parsed.watchId);
    if (w === null || parsed.seq > w.seq) throw new ToolError(UNKNOWN_CURSOR);
    if (videoId !== undefined && w.videoId !== videoId) {
      const watched = w.videoId === null ? 'every video' : `the video "${w.videoId}"`;
      throw new ToolError(
        `That cursor watches ${watched}, not "${videoId}". Pass the videoId of the call that gave you the cursor (or leave videoId out), or call without a cursor to start a new watch.`
      );
    }
    const acked = acknowledge(w, parsed.seq);
    const touched = touch(w);
    if (acked || touched) await saveWatch(w);
    return w;
  });
  return { watch, seq: parsed.seq };
}

/**
 * Records that an answer carries these keys, and gives its number. When another call has
 * delivered any of them meanwhile, records nothing and gives the delivered keys instead, so
 * the answer can be built again without repeating anything.
 */
async function offer(
  watchId: string,
  keys: string[]
): Promise<{ seq: number } | { delivered: string[] }> {
  return withWatchLock(watchId, async () => {
    const w = await readWatch(watchId);
    if (w === null) throw new ToolError(UNKNOWN_CURSOR);
    const done = new Set(w.delivered);
    if (keys.some((k) => done.has(k))) return { delivered: w.delivered };
    w.seq += 1;
    w.offered = { seq: w.seq, keys };
    w.touchedAt = new Date().toISOString();
    await saveWatch(w);
    return { seq: w.seq };
  });
}

/**
 * A call without a cursor never waits: it makes the watch and answers at once with its cursor,
 * so a first answer that gets lost can never move where the watch starts from.
 */
async function startWatch(
  videoId: string | null,
  fromStart: boolean,
  ctx: ToolContext,
  images: ImageMode
): Promise<ToolResult> {
  const scan = await scanEvents(videoId);
  const events = [...scan.events.values()];
  const watch = await createWatch(videoId, fromStart ? [] : events.map((e) => e.key));
  if (!fromStart || events.length === 0) {
    return watchStarted(formatCursor(watch.watchId, 0), scan, fromStart);
  }
  const prepared = await prepare(events, scan, ctx, images);
  const got = await offer(watch.watchId, prepared.keys);
  // Nobody else knows this watch yet, so nothing can have been delivered meanwhile.
  if (!('seq' in got)) throw new Error('A new watch already had deliveries.');
  return prepared.render(formatCursor(watch.watchId, got.seq));
}

async function run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const images = (args.images as ImageMode | undefined) ?? 'overview';
  const seconds = Math.min(900, Math.max(5, Math.round(Number(args.timeoutSeconds ?? 240))));
  const deadline = Date.now() + seconds * timing.secondMs;
  const videoId =
    args.videoId === undefined ? undefined : (await requireVideo(args.videoId)).videoId;

  if (args.cursor === undefined) {
    return startWatch(videoId ?? null, args.from === 'start', ctx, images);
  }

  const { watch, seq } = await openWatch(args.cursor, videoId);
  const cursor = formatCursor(watch.watchId, seq);

  const stop = new AbortController();
  const onAbort = () => stop.abort();
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  if (ctx.signal.aborted) stop.abort();
  waiting.get(watch.watchId)?.abort();
  waiting.set(watch.watchId, stop);

  try {
    let delivered = new Set(watch.delivered);
    let burstWaited = false;
    let freshAfter = 0;
    let lastProgress = Date.now();
    for (;;) {
      const scan = await scanEvents(watch.videoId, freshAfter);
      if (stop.signal.aborted) return stopped(cursor, !ctx.signal.aborted);
      const fresh = [...scan.events.values()].filter((e) => !delivered.has(e.key));
      if (fresh.length > 0) {
        // Comments of one pause often finish moments apart: give the rest a chance to join.
        if (!burstWaited && scan.processing > 0) {
          burstWaited = true;
          await sleep(timing.burstMs, stop.signal);
          // The shared scan may be older than the wait: ask for one that saw the burst finish.
          freshAfter = Date.now();
          continue;
        }
        const prepared = await prepare(fresh, scan, ctx, images);
        if (stop.signal.aborted) return stopped(cursor, !ctx.signal.aborted);
        const got = await offer(watch.watchId, prepared.keys);
        if ('seq' in got) return prepared.render(formatCursor(watch.watchId, got.seq));
        delivered = new Set(got.delivered);
        continue;
      }
      const left = deadline - Date.now();
      if (left <= 0) return nothingYet(cursor, scan, seconds);
      if (Date.now() - lastProgress >= timing.progressMs) {
        lastProgress = Date.now();
        ctx.progress(
          scan.processing > 0
            ? `waiting: ${plural(scan.processing, 'comment')} still processing`
            : 'waiting: nothing processing yet'
        );
      }
      await sleep(Math.min(timing.pollMs, left), stop.signal);
    }
  } finally {
    ctx.signal.removeEventListener('abort', onAbort);
    if (waiting.get(watch.watchId) === stop) waiting.delete(watch.watchId);
  }
}

const waitForFeedback: Tool = {
  name: 'wait_for_feedback',
  title: 'Wait for feedback',
  description: `Waits for new feedback and returns it: comments whose processing has finished (transcript and stills ready, in the same form as get_feedback) and reviewers pressing Done. A first call, without a cursor, never waits: it starts a watch and answers at once with its cursor (from "now": nothing yet; from "start": what has finished so far). Then call with that cursor: it blocks for up to timeoutSeconds until something new is ready. The first line of every answer is a cursor: pass the latest one to the next call, every time, and nothing is missed or repeated, even if an answer was lost. If nothing arrives in time it says so and gives the same cursor back: just call again. Only one caller may wait on a cursor at a time; a second agent starts its own watch. At most ${MAX_COMMENTS} comments per answer, fewer when they are long: the rest come at once on the next call. Leave videoId out to watch every video. To keep working meanwhile, hand the waiting to a background subagent.`,
  inputSchema: {
    type: 'object',
    properties: {
      videoId: {
        ...VIDEO_ID_PROP,
        description: `${VIDEO_ID_PROP.description} Leave it out to watch every video. With a cursor it must match the call that started the watch.`,
      },
      cursor: {
        type: 'string',
        description:
          'The cursor from the previous wait_for_feedback answer. Leave it out only on the first call, which answers at once with a cursor.',
        maxLength: 64,
      },
      from: {
        type: 'string',
        enum: ['now', 'start'],
        default: 'now',
        description:
          'Only for a first call (no cursor). "now" (the default): only feedback that finishes from here on. "start": everything finished so far comes back at once, then new feedback.',
      },
      timeoutSeconds: {
        type: 'integer',
        minimum: 5,
        maximum: 900,
        default: 240,
        description:
          'How long a call with a cursor waits for something new before answering "Nothing new yet" (5 to 900, default 240).',
      },
      images: {
        type: 'string',
        enum: IMAGE_MODES,
        default: 'overview',
        description: `${IMAGE_MODE_DESCRIPTION} Default "overview". At most ${MAX_IMAGES_PER_ANSWER} images per answer.`,
      },
    },
    additionalProperties: false,
  },
  // Each answer records what this agent was given, and the next call acknowledges it: calling
  // it changes the watch, and calling it twice gives different answers. It changes no feedback.
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  longRunning: true,
  run,
};

export const watchTools: Tool[] = [waitForFeedback];
