import { SAVE_TROUBLE_AFTER_MS } from '@/lib/constants';
import type { CaptureEvent, CommentMeta, CompleteBody, PlayerInfo } from '@/lib/types';
import { ChunkStoreIdb } from './idb';
import { Uploader } from './uploader';

const player: PlayerInfo = {
  containerWidth: 800,
  containerHeight: 450,
  videoWidth: 1920,
  videoHeight: 1080,
  contentRect: { x: 0, y: 0, width: 800, height: 450 },
  fullscreen: false,
  devicePixelRatio: 1,
};
const sid = 'sess1';
const cid = 'com1';
const meta: CommentMeta = {
  commentId: cid,
  sessionId: sid,
  version: 1,
  kind: 'moment',
  pausedAtVideoTime: 3.2,
  startedAt: '2026-11-21T10:00:00.000Z',
  endedAt: null,
  durationMs: null,
  audioMime: 'audio/webm;codecs=opus',
  totalChunks: null,
  player,
};
const completeBody: CompleteBody = {
  totalChunks: 2,
  endedAt: '2026-11-21T10:00:04.000Z',
  durationMs: 4000,
  player,
};
const ev: CaptureEvent = { t: 5, type: 'visibility', state: 'blur' };

let n = 0;
/** A fresh token per test keeps the shared fake IndexedDB from leaking between tests. */
const freshToken = () => `tok-${++n}-${Math.random().toString(36).slice(2)}`;
const ok = (seq = 0) => Response.json({ received: seq });
const calls = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.map(([url, init]) => `${(init as RequestInit).method} ${String(url)}`);
const chunkUrl = (token: string, seq: number, c = cid) =>
  `PUT /api/r/${token}/sessions/${sid}/comments/${c}/chunks/${seq}`;
const completeUrl = (token: string, c = cid) =>
  `POST /api/r/${token}/sessions/${sid}/comments/${c}/complete`;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  // fake-indexeddb schedules with setImmediate, which must stay real.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Uploader', () => {
  it('Uploader persists before sending and retries until success', async () => {
    const token = freshToken();
    const store = new ChunkStoreIdb();
    let storedAtFirstFetch = -1;
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async () => {
        storedAtFirstFetch = (await store.chunksForToken(token)).length;
        throw new TypeError('offline');
      })
      .mockResolvedValue(ok());
    const up = new Uploader({ token, fetchImpl, store, onTrouble: () => {} });
    await up.enqueue({ sid, cid, seq: 0, audio: new Blob(['a']), events: [], meta });
    expect(up.pendingCount).toBe(1);
    // the first fetch reads IndexedDB, which needs real time to answer
    await vi.waitFor(() => expect(storedAtFirstFetch).toBe(1));
    expect(up.pendingCount).toBe(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(up.pendingCount).toBe(0);
  });

  it('sends the chunk as a multipart PUT with audio, events and meta', async () => {
    const token = freshToken();
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const up = new Uploader({ token, fetchImpl, onTrouble: () => {} });
    const audio = new Blob(['abc'], { type: 'audio/webm' });
    await up.enqueue({ sid, cid, seq: 0, audio, events: [ev], meta });
    await up.enqueue({ sid, cid, seq: 1, audio, events: [] });
    await vi.advanceTimersByTimeAsync(10);
    expect(calls(fetchImpl)).toEqual([chunkUrl(token, 0), chunkUrl(token, 1)]);
    const form = fetchImpl.mock.calls[0][1].body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const sent = form.get('audio') as File;
    expect(sent.size).toBe(3);
    expect(sent.type).toBe('audio/webm');
    expect(JSON.parse(form.get('events') as string)).toEqual([ev]);
    expect(JSON.parse(form.get('meta') as string)).toEqual(meta);
    expect((fetchImpl.mock.calls[1][1].body as FormData).has('meta')).toBe(false);
  });

  it('Uploader signals trouble after 20s of failures and clears it on success', async () => {
    const token = freshToken();
    let online = false;
    const fetchImpl = vi.fn(async () => {
      if (!online) throw new TypeError('offline');
      return ok();
    });
    const onTrouble = vi.fn();
    const up = new Uploader({ token, fetchImpl, onTrouble });
    await up.enqueue({ sid, cid, seq: 0, audio: new Blob(['a']), events: [], meta });
    await vi.advanceTimersByTimeAsync(SAVE_TROUBLE_AFTER_MS - 1000);
    expect(onTrouble).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(onTrouble.mock.calls).toEqual([[true]]);
    online = true;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(onTrouble.mock.calls).toEqual([[true], [false]]);
    expect(up.pendingCount).toBe(0);
  });

  it('treats 5xx and 429 responses as failures to retry', async () => {
    const token = freshToken();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValue(ok());
    const up = new Uploader({ token, fetchImpl, onTrouble: () => {} });
    await up.enqueue({ sid, cid, seq: 0, audio: new Blob(['a']), events: [], meta });
    await vi.advanceTimersByTimeAsync(3100);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(up.pendingCount).toBe(0);
  });

  it('backs off 1s, 2s, 4s and so on, capped at 30s', async () => {
    const token = freshToken();
    const at: number[] = [];
    const start = Date.now();
    const fetchImpl = vi.fn(async () => {
      at.push(Date.now() - start);
      throw new TypeError('offline');
    });
    const up = new Uploader({ token, fetchImpl, onTrouble: () => {} });
    await up.enqueue({ sid, cid, seq: 0, audio: new Blob(['a']), events: [], meta });
    await vi.advanceTimersByTimeAsync(125_000);
    const gaps = at.slice(1).map((t, i) => Math.round((t - at[i]) / 1000));
    expect(gaps).toEqual([1, 2, 4, 8, 16, 30, 30, 30]);
  });

  it('sends chunks in seq order per comment with at most 2 requests in flight', async () => {
    const token = freshToken();
    const gates: Array<{ url: string; resolve: (r: Response) => void }> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = vi.fn((url: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const d = deferred<Response>();
      gates.push({ url, resolve: d.resolve });
      return d.promise.finally(() => {
        inFlight--;
      });
    });
    const up = new Uploader({
      token,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onTrouble: () => {},
    });
    const audio = new Blob(['a']);
    for (const c of ['a', 'b', 'c']) {
      for (const seq of [0, 1]) {
        await up.enqueue({
          sid,
          cid: c,
          seq,
          audio,
          events: [],
          meta: seq === 0 ? meta : undefined,
        });
      }
    }
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(5);
      expect(gates.length).toBeGreaterThan(i);
      gates[i].resolve(ok());
    }
    await vi.advanceTimersByTimeAsync(5);
    expect(up.pendingCount).toBe(0);
    expect(maxInFlight).toBe(2);
    const order = gates.map((g) => g.url.split('/comments/')[1]);
    for (const c of ['a', 'b', 'c']) {
      expect(order.indexOf(`${c}/chunks/0`)).toBeLessThan(order.indexOf(`${c}/chunks/1`));
    }
    // seq 1 of a comment never starts while its seq 0 is still in flight
    expect(order.slice(0, 2)).toEqual(['a/chunks/0', 'b/chunks/0']);
  });

  it('drops a chunk the server refuses (413) and reports it instead of retrying forever', async () => {
    const token = freshToken();
    const store = new ChunkStoreIdb();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('too big', { status: 413 }));
    const onRejected = vi.fn();
    const up = new Uploader({ token, fetchImpl, store, onTrouble: () => {}, onRejected });
    await up.enqueue({ sid, cid, seq: 0, audio: new Blob(['a']), events: [], meta });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(up.pendingCount).toBe(0);
    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ sid, cid, seq: 0 }), 413);
    await vi.waitFor(async () => expect(await store.chunksForToken(token)).toEqual([]));
  });

  it('resumePending re-sends chunks left in IndexedDB by a previous page load', async () => {
    const token = freshToken();
    const offline = vi.fn().mockRejectedValue(new TypeError('offline'));
    const first = new Uploader({ token, fetchImpl: offline, onTrouble: () => {} });
    await first.enqueue({ sid, cid, seq: 0, audio: new Blob(['aa']), events: [ev], meta });
    await first.enqueue({ sid, cid, seq: 1, audio: new Blob(['bbb']), events: [] });
    first.dispose();

    // someone else's chunks on the same browser must be left alone
    const otherToken = freshToken();
    const other = new Uploader({ token: otherToken, fetchImpl: offline, onTrouble: () => {} });
    await other.enqueue({ sid, cid, seq: 0, audio: new Blob(['x']), events: [], meta });
    other.dispose();

    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const second = new Uploader({ token, fetchImpl, onTrouble: () => {} });
    await second.resumePending();
    await second.whenIdle();
    expect(calls(fetchImpl)).toEqual([chunkUrl(token, 0), chunkUrl(token, 1)]);
    const form = fetchImpl.mock.calls[0][1].body as FormData;
    expect((form.get('audio') as File).size).toBe(2);
    expect(JSON.parse(form.get('events') as string)).toEqual([ev]);
    expect(JSON.parse(form.get('meta') as string)).toEqual(meta);
    expect(second.pendingCount).toBe(0);
    const store = new ChunkStoreIdb();
    await vi.waitFor(async () => expect(await store.chunksForToken(token)).toEqual([]));
    expect(await store.chunksForToken(otherToken)).toHaveLength(1);
  });

  it('resumePending finishes a comment whose complete call was still waiting', async () => {
    const token = freshToken();
    const offline = vi.fn().mockRejectedValue(new TypeError('offline'));
    const first = new Uploader({ token, fetchImpl: offline, onTrouble: () => {} });
    await first.enqueue({ sid, cid, seq: 0, audio: new Blob(['a']), events: [], meta });
    void first.complete(sid, cid, { ...completeBody, totalChunks: 1 }).catch(() => {});
    const store = new ChunkStoreIdb();
    await vi.waitFor(async () => expect(await store.completesForToken(token)).toHaveLength(1));
    first.dispose();

    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const second = new Uploader({ token, fetchImpl, onTrouble: () => {} });
    await second.resumePending();
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() =>
      expect(calls(fetchImpl)).toEqual([chunkUrl(token, 0), completeUrl(token)])
    );
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body as string)).toEqual({
      ...completeBody,
      totalChunks: 1,
    });
    await vi.waitFor(async () => {
      expect(await store.completesForToken(token)).toEqual([]);
      expect(await store.chunksForToken(token)).toEqual([]);
    });
  });

  it('complete waits for every chunk of the comment before posting', async () => {
    const token = freshToken();
    const gate = deferred<Response>();
    const fetchImpl = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(ok());
    const up = new Uploader({ token, fetchImpl, onTrouble: () => {} });
    await up.enqueue({ sid, cid, seq: 0, audio: new Blob(['a']), events: [], meta });
    let done = false;
    const p = up.complete(sid, cid, { ...completeBody, totalChunks: 1 }).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    gate.resolve(ok());
    await p;
    expect(calls(fetchImpl)).toEqual([chunkUrl(token, 0), completeUrl(token)]);
    const init = fetchImpl.mock.calls[1][1] as RequestInit;
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ ...completeBody, totalChunks: 1 });
  });

  it('complete re-sends missing chunks reported by a 409', async () => {
    const token = freshToken();
    let completes = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/complete')) {
        completes++;
        return completes === 1
          ? Response.json({ ok: false, missing: [1] }, { status: 409 })
          : Response.json({ ok: true });
      }
      return ok();
    });
    const up = new Uploader({
      token,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onTrouble: () => {},
    });
    await up.enqueue({ sid, cid, seq: 0, audio: new Blob(['a']), events: [], meta });
    await up.enqueue({ sid, cid, seq: 1, audio: new Blob(['bb']), events: [ev] });
    await up.complete(sid, cid, completeBody);
    expect(calls(fetchImpl)).toEqual([
      chunkUrl(token, 0),
      chunkUrl(token, 1),
      completeUrl(token),
      chunkUrl(token, 1),
      completeUrl(token),
    ]);
    const resent = fetchImpl.mock.calls[3] as unknown as [string, RequestInit];
    expect(((resent[1].body as FormData).get('audio') as File).size).toBe(2);
    const store = new ChunkStoreIdb();
    await vi.waitFor(async () => expect(await store.chunksForToken(token)).toEqual([]));
  });

  it('complete retries with backoff when the network is down', async () => {
    const token = freshToken();
    let completes = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/complete') && ++completes < 3) throw new TypeError('offline');
      return ok();
    });
    const up = new Uploader({
      token,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onTrouble: () => {},
    });
    let done = false;
    void up.complete(sid, cid, { ...completeBody, totalChunks: 0 }).then(() => {
      done = true;
    });
    // the complete call is persisted first, which needs real time
    await vi.waitFor(() => expect(completes).toBe(1), { interval: 1 });
    await vi.advanceTimersByTimeAsync(2500);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(true);
    expect(completes).toBe(3);
  });

  it('complete rejects when the server wants a chunk the client no longer has', async () => {
    const token = freshToken();
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: false, missing: [4] }, { status: 409 })
    );
    const up = new Uploader({
      token,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onTrouble: () => {},
    });
    await expect(up.complete(sid, cid, completeBody)).rejects.toThrow(/missing/i);
  });

  it('still uploads when IndexedDB is unavailable', async () => {
    const token = freshToken();
    const broken = {
      putChunk: () => Promise.reject(new Error('no idb')),
      deleteChunk: () => Promise.reject(new Error('no idb')),
      chunksForToken: () => Promise.reject(new Error('no idb')),
      putComplete: () => Promise.reject(new Error('no idb')),
      deleteComplete: () => Promise.reject(new Error('no idb')),
      completesForToken: () => Promise.reject(new Error('no idb')),
    } as unknown as ChunkStoreIdb;
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const up = new Uploader({ token, fetchImpl, store: broken, onTrouble: () => {} });
    await up.resumePending();
    await up.enqueue({ sid, cid, seq: 0, audio: new Blob(['a']), events: [], meta });
    await up.complete(sid, cid, { ...completeBody, totalChunks: 1 });
    expect(calls(fetchImpl)).toEqual([chunkUrl(token, 0), completeUrl(token)]);
  });
});
