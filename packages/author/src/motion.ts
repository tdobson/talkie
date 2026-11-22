import { localBboxAt } from './evaluate';
import type { AnimProp, Ease, Key, Node, Vec } from './model';
import { isStretched } from './paint';

/** Two motions on the same node and property overlap in time, or disagree where they meet. */
export class MotionConflictError extends Error {
  constructor(
    public readonly node: Node,
    public readonly prop: AnimProp,
    message: string
  ) {
    super(message);
    this.name = 'MotionConflictError';
  }
}

/** A beat is outside the scene, or is timed to a voice line that does not exist. */
export class TimingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimingError';
  }
}

type Span = [number, number];

/** What the motion helpers need to know about the scene being built. */
export interface MotionState {
  size: [number, number];
  duration: number;
  camera: Node;
  /** Time spans already animated, per node and property. */
  spans: Map<Node, Partial<Record<AnimProp, Span[]>>>;
}

export type KeyInput = { t: number; v: number | Vec; ease?: Ease };

const EPS = 1e-9;
const VECTOR_PROPS: AnimProp[] = ['position', 'scale'];
const label = (n: Node) => `"${n.name}" (${n.id})`;

function keyValue(n: Node, prop: AnimProp, v: number | Vec): number | Vec {
  const vector = VECTOR_PROPS.includes(prop);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new TypeError(`${prop} on ${label(n)} needs finite numbers`);
    }
    if (prop === 'position') {
      throw new TypeError(`position on ${label(n)} needs [x, y] values`);
    }
    return prop === 'scale' ? [v, v] : v;
  }
  if (!vector) {
    throw new TypeError(`${prop} on ${label(n)} needs number values, not [x, y]`);
  }
  if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) {
    throw new TypeError(`${prop} on ${label(n)} needs finite numbers`);
  }
  return [v[0], v[1]];
}

const sameValue = (a: number | Vec, b: number | Vec): boolean =>
  typeof a === 'number' || typeof b === 'number' ? a === b : a[0] === b[0] && a[1] === b[1];

const show = (v: number | Vec): string =>
  typeof v === 'number' ? String(v) : `[${v[0]}, ${v[1]}]`;

/** Throws TimingError unless a motion's duration is a finite number of seconds above zero. */
function checkDuration(what: string, dur: number): void {
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new TimingError(`${what} needs a duration above 0 s, got ${dur}`);
  }
}

/**
 * Adds one motion (a run of keys) to a node. Keys on the same property are merged and sorted.
 * Throws TimingError for a key outside the scene and MotionConflictError when the run overlaps
 * an earlier one on the same property, or meets one at an instant with a different value.
 */
export function addKeys(state: MotionState, n: Node, prop: AnimProp, input: KeyInput[]): void {
  if (input.length === 0) {
    throw new TypeError(`${prop} on ${label(n)} needs at least one key`);
  }
  const keys: Key[] = input
    .map((key) => ({ t: key.t, v: keyValue(n, prop, key.v), ease: key.ease ?? 'inOut' }))
    .sort((a, b) => a.t - b.t);
  keys.forEach((key, index) => {
    if (!Number.isFinite(key.t) || key.t < -EPS || key.t > state.duration + EPS) {
      throw new TimingError(
        `${prop} on ${label(n)} has a key at ${key.t} s, outside the scene (0 to ${state.duration} s)`
      );
    }
    if (index > 0 && key.t - keys[index - 1].t < EPS) {
      throw new MotionConflictError(n, prop, `${prop} on ${label(n)} has two keys at ${key.t} s`);
    }
  });

  const span: Span = [keys[0].t, keys[keys.length - 1].t];
  const byProp = state.spans.get(n) ?? {};
  state.spans.set(n, byProp);
  const spans = byProp[prop] ?? [];
  byProp[prop] = spans;
  const clash = spans.find((s) => span[0] < s[1] - EPS && s[0] < span[1] - EPS);
  if (clash) {
    throw new MotionConflictError(
      n,
      prop,
      `${prop} on ${label(n)} is animated twice at once: ${span[0]} to ${span[1]} s overlaps ${clash[0]} to ${clash[1]} s`
    );
  }
  // Two motions may meet at one instant, but only one value can be shown there.
  const existing = n.tracks.find((candidate) => candidate.prop === prop)?.keys ?? [];
  for (const key of keys) {
    const met = existing.find((other) => Math.abs(other.t - key.t) < EPS);
    if (met && !sameValue(met.v, key.v)) {
      throw new MotionConflictError(
        n,
        prop,
        `${prop} on ${label(n)} is given two values at ${key.t} s: ${show(met.v)} and ${show(key.v)}`
      );
    }
  }
  spans.push(span);

  let track = n.tracks.find((candidate) => candidate.prop === prop);
  if (!track) {
    track = { prop, keys: [] };
    n.tracks.push(track);
  }
  const merged = track.keys;
  keys.forEach((key, index) => {
    const at = merged.findIndex((existing) => Math.abs(existing.t - key.t) < EPS);
    if (at === -1) {
      merged.push(key);
      return;
    }
    // Two motions meet at this instant with the same value. The key that starts a segment wins,
    // because its ease describes the segment that leaves it.
    const endsHere = index === keys.length - 1 && keys.length > 1;
    if (!endsHere) {
      merged[at] = key;
    }
  });
  merged.sort((a, b) => a.t - b.t);
}

export function fade(
  state: MotionState,
  n: Node,
  at: number,
  o: { dur?: number; from?: number; to?: number; ease?: Ease } = {}
): void {
  const { dur = 0.4, from = 0, to = 100, ease = 'inOut' } = o;
  checkDuration(`fade on ${label(n)}`, dur);
  addKeys(state, n, 'opacity', [
    { t: at, v: from, ease },
    { t: at + dur, v: to, ease },
  ]);
  if (from === 0) {
    n.transform.opacity = 0;
  }
}

export function rise(
  state: MotionState,
  n: Node,
  at: number,
  o: { dur?: number; dy?: number } = {}
): void {
  const { dur = 0.6, dy = 40 } = o;
  checkDuration(`rise on ${label(n)}`, dur);
  const [x, y] = n.transform.position;
  addKeys(state, n, 'position', [
    { t: at, v: [x, y + dy], ease: 'out' },
    { t: at + dur, v: [x, y], ease: 'out' },
  ]);
  fade(state, n, at, { dur });
}

export function pop(state: MotionState, n: Node, at: number, o: { dur?: number } = {}): void {
  const { dur = 0.35 } = o;
  checkDuration(`pop on ${label(n)}`, dur);
  const box = localBboxAt(n, at + dur);
  if (!box) {
    throw new Error(`pop needs a node with paths, and ${label(n)} has none`);
  }
  addKeys(state, n, 'scale', [
    { t: at, v: [0, 0], ease: 'out' },
    { t: at + dur * 0.7, v: [108, 108], ease: 'inOut' },
    { t: at + dur, v: [100, 100], ease: 'inOut' },
  ]);
  fade(state, n, at, { dur: dur * 0.4 });
  // Scale about the centre of the drawing. Moving anchor and position together keeps it in place.
  const centre: Vec = [box.x + box.width / 2, box.y + box.height / 2];
  // A position track (from rise or tween) moves by the same amount, or it would pull the node away.
  const { anchor, position } = n.transform;
  const shift: Vec = [centre[0] - anchor[0], centre[1] - anchor[1]];
  n.transform.position = [position[0] + shift[0], position[1] + shift[1]];
  n.transform.anchor = centre;
  for (const key of n.tracks.find((track) => track.prop === 'position')?.keys ?? []) {
    const [x, y] = key.v as Vec;
    key.v = [x + shift[0], y + shift[1]];
  }
}

function trim(n: Node): void {
  if (n.items.length === 0) {
    throw new Error(`draw needs a node with paths of its own, and ${label(n)} has none`);
  }
  // A stretched radial fill is drawn in a frame of its own, which a trim cannot follow.
  if (n.items.some((item) => isStretched(item.style.fill))) {
    throw new Error(
      `draw cannot trim ${label(n)}: its radial gradient is stretched, and a trim would not follow the drawing`
    );
  }
  n.trimmed = true;
}

export function draw(state: MotionState, n: Node, at: number, dur = 1): void {
  checkDuration(`draw on ${label(n)}`, dur);
  trim(n);
  addKeys(state, n, 'trimEnd', [
    { t: at, v: 0, ease: 'inOut' },
    { t: at + dur, v: 100, ease: 'inOut' },
  ]);
}

export function tween(state: MotionState, n: Node, prop: AnimProp, keys: KeyInput[]): void {
  if (prop === 'trimEnd') {
    trim(n);
  }
  addKeys(state, n, prop, keys);
}

export function camera(
  state: MotionState,
  at: number,
  o: { dur?: number; scaleTo?: number; origin?: Vec } = {}
): void {
  const { dur = 6, scaleTo = 103.5 } = o;
  const origin: Vec = o.origin ?? [state.size[0] / 2, state.size[1] / 2];
  checkDuration('camera', dur);
  const cam = state.camera;
  // One node carries the camera, so every move has to scale about the same point.
  const [ox, oy] = cam.transform.anchor;
  if (cam.tracks.length > 0 && (ox !== origin[0] || oy !== origin[1])) {
    throw new MotionConflictError(
      cam,
      'scale',
      `camera moves about ${show([ox, oy])} already, and cannot also move about ${show(origin)}`
    );
  }
  const from =
    cam.tracks.find((track) => track.prop === 'scale')?.keys.at(-1)?.v ?? cam.transform.scale;
  addKeys(state, cam, 'scale', [
    { t: at, v: from, ease: 'inOut' },
    { t: at + dur, v: [scaleTo, scaleTo], ease: 'inOut' },
  ]);
  cam.transform.anchor = [origin[0], origin[1]];
  cam.transform.position = [origin[0], origin[1]];
}
