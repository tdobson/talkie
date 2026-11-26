import { randomBytes } from 'node:crypto';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/lib/config';
import { readJson, writeJsonAtomic } from '@/lib/storage/json';

// The cursors of wait_for_feedback, kept on the server so an agent never misses or gets the
// same feedback twice, even when an answer is lost on the way. A watch remembers what has been
// delivered (acknowledged) and what the last answer offered. Passing back the cursor of that
// answer acknowledges it; passing an older one gets the unacknowledged events again.

export interface WatchRecord {
  watchId: string;
  /** The one video watched, or null for every video. */
  videoId: string | null;
  createdAt: string;
  touchedAt: string;
  /**
   * Event keys the agent has acknowledged: `c:<commentId>:<attempts>` and `s:<sessionId>`. The
   * attempts count of a comment goes up each time it is processed again, so a reprocessed
   * comment has a new key and is delivered again.
   */
  delivered: string[];
  /** What the last answer offered, not yet acknowledged. */
  offered: { seq: number; keys: string[] } | null;
  /** The number of the last answer that offered anything. */
  seq: number;
}

const WATCH_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const CURSOR_RE = /^([A-Za-z0-9_-]{22})\.(0|[1-9]\d{0,8})$/;

/** A watch nobody has used for this long is deleted. */
export const WATCH_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
/** touchedAt is only rewritten when it is older than this, so waiting costs no writes. */
const TOUCH_EVERY_MS = 60 * 60 * 1000;
/** The sweep for expired watches runs at most this often. */
const SWEEP_EVERY_MS = 60 * 60 * 1000;

export function watchesDir(): string {
  return join(config().dataDir, 'mcp', 'watches');
}

function watchPath(watchId: string): string {
  if (!WATCH_ID_RE.test(watchId)) throw new Error('Invalid watch id.');
  return join(watchesDir(), `${watchId}.json`);
}

/** 16 random bytes as base64url: 22 characters. */
export function newWatchId(): string {
  return randomBytes(16).toString('base64url');
}

export function formatCursor(watchId: string, seq: number): string {
  return `${watchId}.${seq}`;
}

/** The watch and answer number a cursor names, or null when it is not a cursor. */
export function parseCursor(cursor: string): { watchId: string; seq: number } | null {
  const m = CURSOR_RE.exec(cursor.trim());
  return m ? { watchId: m[1], seq: Number(m[2]) } : null;
}

/** The watch, or null when there is none (never made, expired, or unreadable). */
export async function readWatch(watchId: string): Promise<WatchRecord | null> {
  if (!WATCH_ID_RE.test(watchId)) return null;
  try {
    const w = await readJson<WatchRecord>(watchPath(watchId));
    if (w === null || !Array.isArray(w.delivered) || typeof w.seq !== 'number') return null;
    return w;
  } catch {
    return null;
  }
}

export async function saveWatch(w: WatchRecord): Promise<void> {
  await writeJsonAtomic(watchPath(w.watchId), w);
}

// Each watch is read, changed and written back, so changes to one watch run one after another
// within this process. Only the changes are serialised, never the waiting: a second call on
// the same cursor must not queue behind one that is waiting for minutes.
const tails = new Map<string, Promise<unknown>>();

export async function withWatchLock<T>(watchId: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(watchId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  tails.set(watchId, next);
  try {
    return await next;
  } finally {
    if (tails.get(watchId) === next) tails.delete(watchId);
  }
}

/**
 * Acknowledges what the answer numbered `seq` offered, when it is the last answer: its events
 * count as delivered. An older answer acknowledges nothing, so its events are offered again.
 * Returns true when the record changed.
 */
export function acknowledge(w: WatchRecord, seq: number): boolean {
  if (w.offered === null || seq !== w.seq || w.offered.seq !== seq) return false;
  const delivered = new Set(w.delivered);
  for (const key of w.offered.keys) delivered.add(key);
  w.delivered = [...delivered];
  w.offered = null;
  return true;
}

/** Marks the watch as used, if that has not been done lately. Returns true when it changed. */
export function touch(w: WatchRecord, now = Date.now()): boolean {
  const at = Date.parse(w.touchedAt);
  if (Number.isFinite(at) && now - at < TOUCH_EVERY_MS) return false;
  w.touchedAt = new Date(now).toISOString();
  return true;
}

let lastSweep = 0;

/** Deletes watches not touched for WATCH_EXPIRY_MS, going by the file's time (no reads). */
export async function expireWatches(now = Date.now()): Promise<number> {
  let names: string[];
  try {
    names = await readdir(watchesDir());
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const path = join(watchesDir(), name);
    try {
      const s = await stat(path);
      if (now - s.mtimeMs > WATCH_EXPIRY_MS) {
        await rm(path, { force: true });
        removed += 1;
      }
    } catch {
      // Gone already, or unreadable: nothing to do.
    }
  }
  return removed;
}

/** For tests: make the next createWatch sweep again. */
export function resetSweepForTests(): void {
  lastSweep = 0;
}

/** A new watch with these events already delivered. Sweeps out expired watches first. */
export async function createWatch(
  videoId: string | null,
  delivered: string[],
  now = Date.now()
): Promise<WatchRecord> {
  if (now - lastSweep >= SWEEP_EVERY_MS) {
    lastSweep = now;
    await expireWatches(now);
  }
  const at = new Date(now).toISOString();
  const w: WatchRecord = {
    watchId: newWatchId(),
    videoId,
    createdAt: at,
    touchedAt: at,
    delivered,
    offered: null,
    seq: 0,
  };
  await saveWatch(w);
  return w;
}
