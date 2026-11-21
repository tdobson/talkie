import { SAVE_TROUBLE_AFTER_MS } from '@/lib/constants';
import type { CaptureEvent, CommentMeta, CompleteBody } from '@/lib/types';
import { ChunkStoreIdb, type PendingComplete } from './idb';

export interface PendingChunk {
  key: string;
  token: string;
  sid: string;
  cid: string;
  seq: number;
  audio: Blob;
  events: CaptureEvent[];
  meta?: CommentMeta;
}

export interface UploaderOptions {
  token: string;
  fetchImpl?: typeof fetch;
  store?: ChunkStoreIdb;
  now?: () => number;
  /** true once any upload has been failing for SAVE_TROUBLE_AFTER_MS, false when the queue drains. */
  onTrouble: (trouble: boolean) => void;
  /** A chunk the server refused outright (too large, bad request, unknown session). It is not retried. */
  onRejected?: (chunk: PendingChunk, status: number) => void;
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;
const MAX_IN_FLIGHT = 2;
const MAX_COMPLETE_ROUNDS = 5;
/**
 * A request with no answer after this long is given up on and retried like any other failure.
 * Kept below SAVE_TROUBLE_AFTER_MS so a hung connection gets one retry before the banner shows.
 */
export const REQUEST_TIMEOUT_MS = 15_000;
/**
 * How long a provisional complete record must have gone without a new chunk before a page
 * load treats its comment as abandoned and completes it. A comment that is being recorded
 * (in another tab, say) writes a chunk every 2 seconds, so it never looks this old.
 */
export const PROVISIONAL_GRACE_MS = 15_000;
/**
 * Statuses that will never succeed on retry. 429 (slow down) and 5xx, 507 (disk nearly full)
 * included, are retried: the audio stays queued here and nothing the reviewer said is dropped.
 */
const REFUSED = new Set([400, 404, 413]);

function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_CAP_MS);
}

interface Entry {
  chunk: PendingChunk;
  /** Confirmed by the server. Kept until the comment completes, in case a 409 asks for it again. */
  acked: boolean;
  /** Loaded from a previous page load with no complete call waiting: nothing will ask for it again. */
  orphan: boolean;
  inFlight: boolean;
  attempts: number;
  retryAt: number;
  firstFailAt: number | null;
}

const commentKey = (sid: string, cid: string) => `${sid}/${cid}`;

/** Chunk upload queue: persists to IndexedDB first, sends in order, retries until the server has it. */
export class Uploader {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly store: ChunkStoreIdb;
  private readonly now: () => number;
  private readonly onTrouble: (trouble: boolean) => void;
  private readonly onRejected: ((chunk: PendingChunk, status: number) => void) | undefined;

  private readonly entries = new Map<string, Entry>();
  private readonly completeFailing = new Map<string, number>();
  /** Comments being recorded now: what a provisional complete record needs to know of them. */
  private readonly recording = new Map<
    string,
    { player: CompleteBody['player']; startedAt: number; total: number }
  >();
  /** Comments whose complete call is under way in this page. */
  private readonly completing = new Set<string>();
  private recheck: ReturnType<typeof setTimeout> | null = null;
  private waiters: Array<{ ready: () => boolean; resolve: () => void }> = [];
  private storeQueue: Promise<unknown> = Promise.resolve();
  private inFlight = 0;
  private wake: ReturnType<typeof setTimeout> | null = null;
  private trouble = false;
  private disposed = false;

  constructor(opts: UploaderOptions) {
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.store = opts.store ?? new ChunkStoreIdb();
    this.now = opts.now ?? (() => Date.now());
    this.onTrouble = opts.onTrouble;
    this.onRejected = opts.onRejected;
  }

  /** Chunks not yet confirmed by the server. */
  get pendingCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (!e.acked) n++;
    return n;
  }

  /** Persists the chunk to IndexedDB, then queues it for sending. */
  async enqueue(chunk: Omit<PendingChunk, 'key' | 'token'>): Promise<void> {
    const key = `${this.token}/${chunk.sid}/${chunk.cid}/${chunk.seq}`;
    const full: PendingChunk = { ...chunk, key, token: this.token };
    // Storage failing (private mode, quota) must not stop the upload itself.
    await this.storeOp((s) => s.putChunk({ ...full, acked: false }));
    await this.noteProgress(full);
    this.entries.set(key, this.entry(full, false, false));
    this.pump();
  }

  /**
   * Keeps a provisional complete record in step with the chunks stored so far. The page's own
   * complete() needs async work that a closing tab never gets to finish; with this record the
   * next visit can still tell the server where the comment ended.
   */
  private async noteProgress(chunk: PendingChunk): Promise<void> {
    const ck = commentKey(chunk.sid, chunk.cid);
    if (this.completing.has(ck)) return;
    const now = this.now();
    let info = this.recording.get(ck);
    if (!info && chunk.meta) {
      const startedAt = Date.parse(chunk.meta.startedAt);
      info = {
        player: chunk.meta.player,
        startedAt: Number.isFinite(startedAt) ? startedAt : now,
        total: 0,
      };
      this.recording.set(ck, info);
    }
    if (!info) return;
    info.total = Math.max(info.total, chunk.seq + 1);
    const rec: PendingComplete = {
      key: `${this.token}/${ck}`,
      token: this.token,
      sid: chunk.sid,
      cid: chunk.cid,
      provisional: true,
      updatedAt: now,
      body: {
        totalChunks: info.total,
        endedAt: new Date(now).toISOString(),
        durationMs: Math.max(0, now - info.startedAt),
        player: info.player,
      },
    };
    await this.storeOp((s) => s.putComplete(rec));
  }

  /** Waits for all chunks of the comment, then tells the server it is complete. */
  async complete(sid: string, cid: string, body: CompleteBody): Promise<void> {
    const rec: PendingComplete = {
      key: `${this.token}/${commentKey(sid, cid)}`,
      token: this.token,
      sid,
      cid,
      body,
    };
    const ck = commentKey(sid, cid);
    this.completing.add(ck);
    this.recording.delete(ck);
    try {
      await this.storeOp((s) => s.putComplete(rec));
      await this.runComplete(rec);
    } finally {
      this.completing.delete(ck);
    }
  }

  /**
   * Loads whatever a previous page load left in IndexedDB for this token and starts sending it.
   *
   * A comment with a complete record is completed once its chunks are in. That includes a
   * comment the tab was closed on mid-recording, which only has the provisional record written
   * as its chunks arrived: it is completed with the chunks that were stored. A provisional
   * record that is still being updated belongs to a comment being recorded right now, so it is
   * left alone and looked at again later.
   */
  async resumePending(): Promise<void> {
    if (this.disposed) return;
    const loaded = await this.storeOp(async (s) => ({
      chunks: await s.chunksForToken(this.token),
      completes: await s.completesForToken(this.token),
    }));
    if (!loaded || this.disposed) return;
    const waiting = new Set(loaded.completes.map((c) => commentKey(c.sid, c.cid)));
    for (const { acked, ...chunk } of loaded.chunks) {
      if (this.entries.has(chunk.key)) continue;
      const ck = commentKey(chunk.sid, chunk.cid);
      // Chunks this page is recording are queued by enqueue(), not from here.
      if (this.recording.has(ck) || this.completing.has(ck)) continue;
      const orphan = !waiting.has(ck);
      if (acked && orphan) {
        void this.storeOp((s) => s.deleteChunk(chunk.key));
        continue;
      }
      this.entries.set(chunk.key, this.entry(chunk, acked, orphan));
    }
    this.pump();
    const now = this.now();
    let lookAgain = false;
    for (const rec of loaded.completes) {
      const ck = commentKey(rec.sid, rec.cid);
      if (this.completing.has(ck)) continue;
      if (rec.provisional && now - (rec.updatedAt ?? 0) < PROVISIONAL_GRACE_MS) {
        lookAgain = true;
        continue;
      }
      this.completing.add(ck);
      this.recording.delete(ck);
      // The comment's own UI is gone after a reload: nobody is left to hear a failure.
      void this.runComplete(rec)
        .catch(() => {})
        .finally(() => this.completing.delete(ck));
    }
    if (lookAgain && this.recheck === null) {
      this.recheck = setTimeout(() => {
        this.recheck = null;
        void this.resumePending().catch(() => {});
      }, PROVISIONAL_GRACE_MS);
    }
  }

  /** Resolves once every queued chunk has been confirmed. */
  whenIdle(): Promise<void> {
    return this.waitFor(() => this.pendingCount === 0);
  }

  /** Stops timers and callbacks. Chunks already persisted stay in IndexedDB for the next load. */
  dispose(): void {
    this.disposed = true;
    if (this.wake) clearTimeout(this.wake);
    this.wake = null;
    if (this.recheck) clearTimeout(this.recheck);
    this.recheck = null;
    this.waiters = [];
  }

  private entry(chunk: PendingChunk, acked: boolean, orphan: boolean): Entry {
    return { chunk, acked, orphan, inFlight: false, attempts: 0, retryAt: 0, firstFailAt: null };
  }

  /** Runs store operations one at a time so a late write cannot undo a later delete. */
  private storeOp<T>(fn: (s: ChunkStoreIdb) => Promise<T>): Promise<T | undefined> {
    const p = this.storeQueue.then(() => fn(this.store)).catch(() => undefined);
    this.storeQueue = p;
    return p;
  }

  private waitFor(ready: () => boolean): Promise<void> {
    if (ready()) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push({ ready, resolve });
    });
  }

  private settleWaiters(): void {
    const still: typeof this.waiters = [];
    for (const w of this.waiters) {
      if (w.ready()) w.resolve();
      else still.push(w);
    }
    this.waiters = still;
  }

  private commentDrained(ck: string): boolean {
    for (const e of this.entries.values()) {
      if (!e.acked && commentKey(e.chunk.sid, e.chunk.cid) === ck) return false;
    }
    return true;
  }

  private chunkUrl(c: PendingChunk): string {
    return `/api/r/${this.token}/sessions/${c.sid}/comments/${c.cid}/chunks/${c.seq}`;
  }

  /** Starts whatever may be sent now, updates the trouble flag, and schedules the next look. */
  private pump(): void {
    if (this.disposed) return;
    if (this.wake) clearTimeout(this.wake);
    this.wake = null;
    const now = this.now();
    let nextAt = Number.POSITIVE_INFINITY;

    // Only the lowest unconfirmed seq of each comment may go: that keeps seq order per comment.
    const heads = new Map<string, Entry>();
    for (const e of this.entries.values()) {
      if (e.acked) continue;
      const ck = commentKey(e.chunk.sid, e.chunk.cid);
      const head = heads.get(ck);
      if (!head || e.chunk.seq < head.chunk.seq) heads.set(ck, e);
    }
    for (const head of heads.values()) {
      if (head.inFlight) continue;
      if (head.retryAt > now) {
        nextAt = Math.min(nextAt, head.retryAt);
        continue;
      }
      if (this.inFlight >= MAX_IN_FLIGHT) break;
      void this.send(head);
    }

    let oldestFailure = Number.POSITIVE_INFINITY;
    for (const e of this.entries.values()) {
      if (!e.acked && e.firstFailAt !== null)
        oldestFailure = Math.min(oldestFailure, e.firstFailAt);
    }
    for (const at of this.completeFailing.values()) oldestFailure = Math.min(oldestFailure, at);

    if (!this.trouble && Number.isFinite(oldestFailure)) {
      const troubleAt = oldestFailure + SAVE_TROUBLE_AFTER_MS;
      if (now >= troubleAt) this.setTrouble(true);
      else nextAt = Math.min(nextAt, troubleAt);
    } else if (this.trouble && this.pendingCount === 0 && this.completeFailing.size === 0) {
      this.setTrouble(false);
    }

    if (Number.isFinite(nextAt)) {
      this.wake = setTimeout(() => this.pump(), Math.max(0, nextAt - now));
    }
  }

  private setTrouble(trouble: boolean): void {
    if (this.trouble === trouble) return;
    this.trouble = trouble;
    this.onTrouble(trouble);
  }

  /**
   * fetch that cannot hang: after REQUEST_TIMEOUT_MS the request is aborted and this rejects,
   * even if the fetch implementation ignores the abort signal.
   */
  private async timedFetch(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new Error('Request timed out'));
      }, REQUEST_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.fetchImpl(url, { ...init, signal: ctrl.signal }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async send(e: Entry): Promise<void> {
    const { chunk } = e;
    e.inFlight = true;
    this.inFlight++;
    const startedAt = this.now();
    let status: number | null = null;
    try {
      const form = new FormData();
      form.set('audio', chunk.audio, `${chunk.seq}.bin`);
      form.set('events', JSON.stringify(chunk.events));
      if (chunk.meta) form.set('meta', JSON.stringify(chunk.meta));
      const res = await this.timedFetch(this.chunkUrl(chunk), { method: 'PUT', body: form });
      status = res.status;
    } catch {
      // network error or timeout: retried below
    }
    e.inFlight = false;
    this.inFlight--;
    if (this.disposed) return;
    if (this.entries.get(chunk.key) !== e) {
      // The comment was dropped while this request was in the air.
      this.pump();
      return;
    }

    if (status !== null && status >= 200 && status < 300) {
      e.acked = true;
      e.attempts = 0;
      e.firstFailAt = null;
      if (e.orphan) {
        this.entries.delete(chunk.key);
        void this.storeOp((s) => s.deleteChunk(chunk.key));
      } else {
        void this.storeOp((s) => s.putChunk({ ...chunk, acked: true }));
      }
    } else if (status !== null && REFUSED.has(status)) {
      this.entries.delete(chunk.key);
      void this.storeOp((s) => s.deleteChunk(chunk.key));
      this.onRejected?.(chunk, status);
    } else {
      e.attempts++;
      const now = this.now();
      // The trouble clock runs from when the failing request started: a hang counts in full.
      if (e.firstFailAt === null) e.firstFailAt = startedAt;
      e.retryAt = now + backoffMs(e.attempts);
    }
    this.settleWaiters();
    this.pump();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /** POSTs complete, retrying network errors, 429 and 5xx with the same backoff as chunks. */
  private async postComplete(rec: PendingComplete): Promise<Response> {
    const ck = commentKey(rec.sid, rec.cid);
    const url = `/api/r/${this.token}/sessions/${rec.sid}/comments/${rec.cid}/complete`;
    for (let attempts = 1; ; attempts++) {
      if (this.disposed) throw new Error('Uploader disposed');
      const startedAt = this.now();
      try {
        const res = await this.timedFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(rec.body),
        });
        if (res.status !== 429 && res.status < 500) {
          if (this.completeFailing.delete(ck)) this.pump();
          return res;
        }
      } catch {
        // network error or timeout: retried below
      }
      if (this.disposed) throw new Error('Uploader disposed');
      if (!this.completeFailing.has(ck)) this.completeFailing.set(ck, startedAt);
      this.pump();
      await this.sleep(backoffMs(attempts));
    }
  }

  private async runComplete(first: PendingComplete): Promise<void> {
    let rec = first;
    const ck = commentKey(rec.sid, rec.cid);
    try {
      for (let round = 0; ; round++) {
        await this.waitFor(() => this.commentDrained(ck));
        const res = await this.postComplete(rec);
        if (res.ok) {
          this.forget(rec);
          return;
        }
        if (res.status !== 409 || round >= MAX_COMPLETE_ROUNDS) {
          throw new Error(`Could not complete comment ${rec.cid}: HTTP ${res.status}`);
        }
        const data = (await res.json().catch(() => null)) as { missing?: unknown } | null;
        const missing = Array.isArray(data?.missing) ? data.missing : [];
        if (missing.length === 0) {
          throw new Error(`Could not complete comment ${rec.cid}: HTTP 409 with no missing list`);
        }
        // A chunk the server refused (too large, say) is gone for good. Everything before it
        // is still worth keeping, so the comment is completed as far as the first such gap.
        const gone = (missing as unknown[]).find(
          (seq) => !this.entries.has(`${this.token}/${ck}/${seq}`)
        );
        if (gone !== undefined) {
          const upTo = typeof gone === 'number' && Number.isInteger(gone) ? gone : 0;
          if (upTo < 1 || upTo >= rec.body.totalChunks) {
            throw new Error(`Could not complete comment ${rec.cid}: missing chunk ${gone} is gone`);
          }
          rec = { ...rec, body: { ...rec.body, totalChunks: upTo } };
          await this.storeOp((s) => s.putComplete(rec));
          continue;
        }
        for (const seq of missing) {
          const e = this.entries.get(`${this.token}/${ck}/${seq}`);
          if (!e) continue;
          e.acked = false;
          e.retryAt = 0;
          void this.storeOp((s) => s.putChunk({ ...e.chunk, acked: false }));
        }
        this.pump();
      }
    } catch (err) {
      if (this.disposed) throw err;
      this.forget(rec);
      throw err;
    }
  }

  /** Drops everything held for a finished (or unfinishable) comment. */
  private forget(rec: PendingComplete): void {
    const ck = commentKey(rec.sid, rec.cid);
    for (const [key, e] of this.entries) {
      if (commentKey(e.chunk.sid, e.chunk.cid) !== ck) continue;
      this.entries.delete(key);
      void this.storeOp((s) => s.deleteChunk(key));
    }
    void this.storeOp((s) => s.deleteComplete(rec.key));
    this.completeFailing.delete(ck);
    this.settleWaiters();
    this.pump();
  }
}
