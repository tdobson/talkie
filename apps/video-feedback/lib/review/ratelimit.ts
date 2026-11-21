// Rolling-window request limits, held in memory. The app runs as one process, so this is
// enough. The store hangs off `globalThis` so every bundled copy of this module shares it.

type Store = Map<string, number[]>;

const STORE_KEY = Symbol.for('video-feedback.ratelimit');
const SWEEP_EVERY = 500;
const holder = globalThis as unknown as Record<symbol, Store | undefined>;
let callsSinceSweep = 0;

function store(): Store {
  let s = holder[STORE_KEY];
  if (!s) {
    s = new Map();
    holder[STORE_KEY] = s;
  }
  return s;
}

/** Drops keys whose newest request is older than the window, so idle sessions cost nothing. */
function sweep(s: Store, cutoff: number): void {
  for (const [key, times] of s) {
    const newest = times[times.length - 1];
    if (newest === undefined || newest <= cutoff) s.delete(key);
  }
}

/**
 * Records one request for `key` and returns true, unless `limit` requests were already
 * allowed in the last `windowMs`. Refused requests are not recorded, so a client that keeps
 * hammering is let back in as soon as its earlier requests age out.
 */
export function allowRequest(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): boolean {
  const s = store();
  const cutoff = now - windowMs;
  if (++callsSinceSweep >= SWEEP_EVERY) {
    callsSinceSweep = 0;
    sweep(s, cutoff);
  }
  const recent = (s.get(key) ?? []).filter((t) => t > cutoff);
  const allowed = recent.length < limit;
  if (allowed) recent.push(now);
  if (recent.length > 0) s.set(key, recent);
  else s.delete(key);
  return allowed;
}

export function resetRateLimits(): void {
  store().clear();
  callsSinceSweep = 0;
}
