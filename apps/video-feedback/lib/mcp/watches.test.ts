import { readdir, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { withTmpData } from '@/test/helpers/tmpData';
import {
  acknowledge,
  createWatch,
  expireWatches,
  formatCursor,
  newWatchId,
  parseCursor,
  readWatch,
  resetSweepForTests,
  touch,
  WATCH_EXPIRY_MS,
  type WatchRecord,
  watchesDir,
  withWatchLock,
} from './watches';

let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  resetSweepForTests();
});
afterEach(() => cleanup());

const record = (over: Partial<WatchRecord> = {}): WatchRecord => ({
  watchId: newWatchId(),
  videoId: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  touchedAt: '2026-11-01T00:00:00.000Z',
  delivered: ['c:a:1'],
  offered: { seq: 2, keys: ['c:b:1', 's:c'] },
  seq: 2,
  ...over,
});

describe('watch cursors', () => {
  it('makes 22 character ids and round-trips cursors', () => {
    const id = newWatchId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(parseCursor(formatCursor(id, 12))).toEqual({ watchId: id, seq: 12 });
    expect(parseCursor(' nope ')).toBeNull();
    expect(parseCursor(`${id}.01`)).toBeNull();
    expect(parseCursor(`${id}.-1`)).toBeNull();
    expect(parseCursor(`../${id.slice(3)}.1`)).toBeNull();
  });

  it('acknowledges only with the cursor of the last answer', () => {
    const older = record();
    expect(acknowledge(older, 1)).toBe(false);
    expect(older.delivered).toEqual(['c:a:1']);

    const latest = record();
    expect(acknowledge(latest, 2)).toBe(true);
    expect(latest.delivered).toEqual(['c:a:1', 'c:b:1', 's:c']);
    expect(latest.offered).toBeNull();
    expect(acknowledge(latest, 2)).toBe(false);
  });

  it('touches a watch at most hourly', () => {
    const w = record();
    const now = Date.parse('2026-11-01T00:30:00.000Z');
    expect(touch(w, now)).toBe(false);
    expect(touch(w, now + 60 * 60 * 1000)).toBe(true);
    expect(w.touchedAt).toBe('2026-11-01T01:30:00.000Z');
  });

  it('stores watches and sweeps out ones unused for 30 days when a new one is made', async () => {
    const old = await createWatch('roof-film-ab12', ['c:x:1']);
    expect(await readWatch(old.watchId)).toEqual(old);
    const past = (Date.now() - WATCH_EXPIRY_MS - 60_000) / 1000;
    await utimes(join(watchesDir(), `${old.watchId}.json`), past, past);
    const kept = await createWatch(null, []);
    resetSweepForTests();
    await createWatch(null, []);
    expect(await readWatch(old.watchId)).toBeNull();
    expect(await readWatch(kept.watchId)).not.toBeNull();
    expect((await readdir(watchesDir())).length).toBe(2);
    expect(await expireWatches()).toBe(0);
  });

  it('runs changes to one watch one after another', async () => {
    const order: string[] = [];
    const slow = withWatchLock('w', async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('first');
    });
    const fast = withWatchLock('w', async () => {
      order.push('second');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['first', 'second']);
  });
});
