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
/** Statuses that will never succeed on retry. 429 and 5xx are retried. */
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
    this.entries.set(key, this.entry(full, false, false));
    this.pump();
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
    await this.storeOp((s) => s.putComplete(rec));
    await this.runComplete(rec);
  }

  /** Loads whatever a previous page load left in IndexedDB for this token and starts sending it. */
  async resumePending(): Promise<void> {
    const loaded = await this.storeOp(async (s) => ({
      chunks: await s.chunksForToken(this.token),
      completes: await s.completesForToken(this.token),
    }));
    if (!loaded) return;
    const waiting = new Set(loaded.completes.map((c) => commentKey(c.sid, c.cid)));
    for (const { acked, ...chunk } of loaded.chunks) {
      if (this.entries.has(chunk.key)) continue;
      const orphan = !waiting.has(commentKey(chunk.sid, chunk.cid));
      if (acked && orphan) {
        void this.storeOp((s) => s.deleteChunk(chunk.key));
        continue;
      }
      this.entries.set(chunk.key, this.entry(chunk, acked, orphan));
    }
    this.pump();
    for (const rec of loaded.completes) {
      // The comment's own UI is gone after a reload: nobody is left to hear a failure.
      void this.runComplete(rec).catch(() => {});
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

  private async send(e: Entry): Promise<void> {
    const { chunk } = e;
    e.inFlight = true;
    this.inFlight++;
    let status: number | null = null;
    try {
      const form = new FormData();
      form.set('audio', chunk.audio, `${chunk.seq}.bin`);
      form.set('events', JSON.stringify(chunk.events));
      if (chunk.meta) form.set('meta', JSON.stringify(chunk.meta));
      const res = await this.fetchImpl(this.chunkUrl(chunk), { method: 'PUT', body: form });
      status = res.status;
    } catch {
      // network error: retried below
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
      if (e.firstFailAt === null) e.firstFailAt = now;
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
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(rec.body),
        });
        if (res.status !== 429 && res.status < 500) {
          if (this.completeFailing.delete(ck)) this.pump();
          return res;
        }
      } catch {
        // network error: retried below
      }
      if (!this.completeFailing.has(ck)) this.completeFailing.set(ck, this.now());
      this.pump();
      await this.sleep(backoffMs(attempts));
    }
  }

  private async runComplete(rec: PendingComplete): Promise<void> {
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
        for (const seq of missing) {
          const e = this.entries.get(`${this.token}/${ck}/${seq}`);
          if (!e) {
            throw new Error(`Could not complete comment ${rec.cid}: missing chunk ${seq} is gone`);
          }
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
