import {
  DEICTIC_WORDS,
  DWELL_MS,
  DWELL_RADIUS,
  KEY_STEP_COLLAPSE_MS,
  MAX_MOMENTS,
  MERGE_DIST,
  MERGE_MS,
  ZOOM_END_MOVE,
} from '@/lib/constants';
import { formatVideoTime } from '@/lib/format';
import { distance } from '@/lib/geometry';
import type {
  CaptureEvent,
  CommentKind,
  Moment,
  MomentKind,
  Transcript,
  ZoomState,
} from '@/lib/types';

const PRIORITY: MomentKind[] = ['click', 'zoom', 'word', 'dwell', 'seek', 'pause'];
type PointerSample = { t: number; x: number; y: number; inside: boolean };
interface Candidate {
  t: number;
  vt: number;
  x: number;
  y: number;
  inside: boolean;
  zoom: ZoomState | null;
  kinds: MomentKind[];
  reasons: string[];
}

export interface SelectInput {
  kind: CommentKind;
  pausedAtVideoTime: number | null;
  durationMs: number;
  events: CaptureEvent[];
  transcript: Transcript | null;
}

export function pointerSamples(events: CaptureEvent[]): PointerSample[] {
  return events
    .filter(
      (e): e is Extract<CaptureEvent, { type: 'pointer' | 'click' }> =>
        e.type === 'pointer' || e.type === 'click'
    )
    .map(({ t, x, y, inside }) => ({ t, x, y, inside }))
    .sort((a, b) => a.t - b.t);
}

export function pointerAt(samples: PointerSample[], t: number): PointerSample | null {
  let found: PointerSample | null = null;
  for (const s of samples) {
    if (s.t > t) break;
    found = s;
  }
  return found;
}

export function videoTimeAt(events: CaptureEvent[], t: number, pausedAt: number): number {
  let vt = pausedAt;
  for (const e of events) {
    if (e.t > t) break;
    if (e.type === 'seek') vt = e.to;
  }
  return vt;
}

export function zoomAt(events: CaptureEvent[], t: number): ZoomState | null {
  let z: ZoomState | null = null;
  for (const e of events) {
    if (e.t > t) break;
    if (e.type === 'zoom')
      z = e.state === 'start' ? { scale: e.scale, originX: e.originX, originY: e.originY } : null;
    if (e.type === 'zoomPan' && z) z = { ...z, originX: e.originX, originY: e.originY };
  }
  return z;
}

export function detectDwells(
  samples: PointerSample[],
  endT: number
): { t: number; x: number; y: number; inside: boolean; ms: number }[] {
  const out: { t: number; x: number; y: number; inside: boolean; ms: number }[] = [];
  let i = 0;
  while (i < samples.length) {
    const anchor = samples[i];
    let j = i + 1;
    while (j < samples.length && distance(samples[j], anchor) <= DWELL_RADIUS) j++;
    const until = j < samples.length ? samples[j].t : endT;
    const ms = until - anchor.t;
    if (ms >= DWELL_MS)
      out.push({ t: (anchor.t + until) / 2, x: anchor.x, y: anchor.y, inside: anchor.inside, ms });
    i = j;
  }
  return out;
}

const norm = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '');

export function selectMoments(input: SelectInput): Moment[] {
  if (input.kind === 'general' || input.pausedAtVideoTime === null) return [];
  const { events, durationMs } = input;
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const samples = pointerSamples(sorted);
  const paused = input.pausedAtVideoTime;
  const at = (
    t: number,
    kind: MomentKind,
    reason: string,
    pos?: { x: number; y: number; inside: boolean },
    vt?: number
  ): Candidate => {
    const p = pos ?? pointerAt(samples, t) ?? { x: 0.5, y: 0.5, inside: true };
    return {
      t,
      vt: vt ?? videoTimeAt(sorted, t, paused),
      x: p.x,
      y: p.y,
      inside: p.inside,
      zoom: zoomAt(sorted, t),
      kinds: [kind],
      reasons: [reason],
    };
  };

  const cands: Candidate[] = [];
  const first = samples[0];
  cands.push(
    at(first?.t ?? 0, 'pause', 'pause', first ?? { x: 0.5, y: 0.5, inside: true }, paused)
  );

  for (const e of sorted) if (e.type === 'click') cands.push(at(e.t, 'click', 'click', e));

  for (const d of detectDwells(samples, durationMs))
    cands.push(at(d.t, 'dwell', `dwell ${(d.ms / 1000).toFixed(1)}s`, d));

  for (const w of input.transcript?.words ?? []) {
    const word = norm(w.word);
    if ((DEICTIC_WORDS as readonly string[]).includes(word)) {
      const t = Math.round(w.start * 1000);
      cands.push(at(t, 'word', `word '${word}' at ${w.start.toFixed(1)}s`));
    }
  }

  const seeks = sorted.filter(
    (e): e is Extract<CaptureEvent, { type: 'seek' }> => e.type === 'seek'
  );
  seeks.forEach((s, i) => {
    const next = seeks[i + 1];
    const collapsed =
      s.via === 'key' && next?.via === 'key' && next.t - s.t <= KEY_STEP_COLLAPSE_MS;
    if (!collapsed)
      cands.push(at(s.t, 'seek', `scrolled to ${formatVideoTime(s.to)}`, undefined, s.to));
  });

  let zoomStart: Candidate | null = null;
  for (const e of sorted) {
    if (e.type !== 'zoom') continue;
    if (e.state === 'start') {
      zoomStart = at(e.t, 'zoom', 'zoom in');
      cands.push(zoomStart);
    } else if (zoomStart) {
      const end = pointerAt(samples, e.t);
      if (end && distance(end, zoomStart) > ZOOM_END_MOVE) {
        const c = at(e.t, 'zoom', 'zoomed view, moved', end);
        c.zoom = zoomAt(sorted, e.t - 1);
        cands.push(c);
      }
      zoomStart = null;
    }
  }

  // merge
  cands.sort((a, b) => a.t - b.t);
  const merged: Candidate[] = [];
  for (const c of cands) {
    const m = merged.find((x) => Math.abs(x.t - c.t) <= MERGE_MS && distance(x, c) <= MERGE_DIST);
    if (!m) {
      merged.push({ ...c, kinds: [...c.kinds], reasons: [...c.reasons] });
      continue;
    }
    const better = rank(c.kinds) < rank(m.kinds);
    if (better)
      Object.assign(m, {
        t: c.t,
        vt: c.vt,
        x: c.x,
        y: c.y,
        inside: c.inside,
        zoom: c.zoom ?? m.zoom,
      });
    for (const k of c.kinds) if (!m.kinds.includes(k)) m.kinds.push(k);
    m.reasons.push(...c.reasons);
  }

  const kept = [...merged]
    .sort((a, b) => rank(a.kinds) - rank(b.kinds) || a.t - b.t)
    .slice(0, MAX_MOMENTS)
    .sort((a, b) => a.t - b.t);

  return kept.map((c, i) => ({
    id: `moment-${String(i + 1).padStart(2, '0')}`,
    t: c.t,
    vt: c.vt,
    x: c.x,
    y: c.y,
    inside: c.inside,
    zoom: c.zoom,
    kinds: [...c.kinds].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b)),
    reasons: c.reasons,
  }));
}

function rank(kinds: MomentKind[]): number {
  return Math.min(...kinds.map((k) => PRIORITY.indexOf(k)));
}

/** Pointer position at the time each word was spoken (for feedback.json). */
export function wordsWithPointer(
  transcript: Transcript,
  events: CaptureEvent[],
  pausedAt: number | null
) {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const samples = pointerSamples(sorted);
  return transcript.words.map((w) => {
    const t = Math.round(w.start * 1000);
    const p = pointerAt(samples, t);
    return {
      ...w,
      pointer:
        p && pausedAt !== null
          ? { x: p.x, y: p.y, inside: p.inside, vt: videoTimeAt(sorted, t, pausedAt) }
          : null,
    };
  });
}
