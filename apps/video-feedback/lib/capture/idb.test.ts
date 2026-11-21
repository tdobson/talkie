import { ChunkStoreIdb, type StoredChunk } from './idb';

let n = 0;
const freshDb = () => `idb-test-${++n}-${Math.random().toString(36).slice(2)}`;

function chunk(token: string, seq: number, text: string): StoredChunk {
  return {
    key: `${token}/s/c/${seq}`,
    token,
    sid: 's',
    cid: 'c',
    seq,
    audio: new Blob([text], { type: 'audio/webm' }),
    events: [{ t: seq, type: 'visibility', state: 'blur' }],
    acked: false,
  };
}

describe('ChunkStoreIdb', () => {
  it('round-trips a chunk including its audio bytes and type', async () => {
    const store = new ChunkStoreIdb(freshDb());
    await store.putChunk(chunk('t1', 0, 'hello'));
    const [got] = await store.chunksForToken('t1');
    expect(got).toMatchObject({ key: 't1/s/c/0', token: 't1', seq: 0, acked: false });
    expect(got.events).toEqual([{ t: 0, type: 'visibility', state: 'blur' }]);
    expect(got.audio.type).toBe('audio/webm');
    expect(await got.audio.text()).toBe('hello');
  });

  it('lists only the chunks for the given token, and survives a new instance', async () => {
    const db = freshDb();
    const store = new ChunkStoreIdb(db);
    await store.putChunk(chunk('t1', 1, 'b'));
    await store.putChunk(chunk('t1', 0, 'a'));
    await store.putChunk(chunk('t2', 0, 'c'));
    const again = new ChunkStoreIdb(db);
    expect((await again.chunksForToken('t1')).map((c) => c.seq).sort()).toEqual([0, 1]);
    expect(await again.chunksForToken('t3')).toEqual([]);
  });

  it('overwrites by key and deletes', async () => {
    const store = new ChunkStoreIdb(freshDb());
    await store.putChunk(chunk('t1', 0, 'a'));
    await store.putChunk({ ...chunk('t1', 0, 'a'), acked: true });
    expect((await store.chunksForToken('t1')).map((c) => c.acked)).toEqual([true]);
    await store.deleteChunk('t1/s/c/0');
    await store.deleteChunk('t1/s/c/0');
    expect(await store.chunksForToken('t1')).toEqual([]);
  });

  it('stores pending complete calls per token', async () => {
    const store = new ChunkStoreIdb(freshDb());
    const body = {
      totalChunks: 1,
      endedAt: 'x',
      durationMs: 5,
      player: {
        containerWidth: 1,
        containerHeight: 1,
        videoWidth: 1,
        videoHeight: 1,
        contentRect: { x: 0, y: 0, width: 1, height: 1 },
        fullscreen: false,
        devicePixelRatio: 1,
      },
    };
    await store.putComplete({ key: 't1/s/c', token: 't1', sid: 's', cid: 'c', body });
    await store.putComplete({ key: 't2/s/c', token: 't2', sid: 's', cid: 'c', body });
    expect(await store.completesForToken('t1')).toEqual([
      { key: 't1/s/c', token: 't1', sid: 's', cid: 'c', body },
    ]);
    await store.deleteComplete('t1/s/c');
    expect(await store.completesForToken('t1')).toEqual([]);
  });
});
