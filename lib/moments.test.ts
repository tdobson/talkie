import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaptureEvent, Transcript } from '@/lib/types';
import {
  detectDwells,
  pointerAt,
  pointerSamples,
  selectMoments,
  videoTimeAt,
  wordsWithPointer,
  zoomAt,
} from './moments';

const fx = (n: string) => JSON.parse(readFileSync(join(__dirname, '../test/fixtures', n), 'utf8'));
const events: CaptureEvent[] = fx('events-basic.json');
const transcript: Transcript = fx('transcript-basic.json');

const p = (t: number, x: number, y: number): CaptureEvent => ({
  t,
  type: 'pointer',
  x,
  y,
  inside: true,
  vt: 12.4,
});
const click = (t: number, x: number, y: number): CaptureEvent => ({
  t,
  type: 'click',
  x,
  y,
  inside: true,
  vt: 12.4,
  button: 0,
});
const seek = (t: number, from: number, to: number, via: 'scrollbar' | 'key'): CaptureEvent => ({
  t,
  type: 'seek',
  from,
  to,
  via,
});

const base = { kind: 'moment' as const, pausedAtVideoTime: 12.4, durationMs: 12000 };

it('returns nothing for general comments', () =>
  expect(
    selectMoments({ ...base, kind: 'general', pausedAtVideoTime: null, events, transcript })
  ).toEqual([]));

it('always includes a pause moment at the paused frame', () => {
  const m = selectMoments({ ...base, events: [], transcript: null });
  expect(m).toHaveLength(1);
  expect(m[0]).toMatchObject({ id: 'moment-01', vt: 12.4, x: 0.5, y: 0.5, kinds: ['pause'] });
});

it('detects a dwell only when the pointer rests 400ms or more', () => {
  const ev = [p(0, 0.3, 0.3), p(100, 0.305, 0.3), p(450, 0.6, 0.6), p(500, 0.9, 0.9)];
  const d = detectDwells(pointerSamples(ev), 1000);
  expect(d.map((x) => [x.x, Math.round(x.ms)])).toEqual([
    [0.3, 450],
    [0.9, 500],
  ]);
});

it("aligns the word 'this' with where the pointer was at 3.2s", () => {
  const m = selectMoments({ ...base, events, transcript });
  const word = m.find((x) => x.reasons.some((r) => r.startsWith("word 'this'")));
  expect(word?.x).toBeCloseTo(0.12);
  expect(word?.y).toBeCloseTo(0.08);
  expect(word?.kinds).toContain('dwell'); // merged with the dwell at the same spot
});

it('uses the seek destination as video time after scrolling', () => {
  const m = selectMoments({ ...base, events, transcript });
  expect(m.find((x) => x.kinds.includes('click'))?.vt).toBe(9.0);
});

it('collapses rapid arrow-key steps into the final frame', () => {
  const ev = [
    seek(1000, 12.4, 12.36, 'key'),
    seek(1200, 12.36, 12.32, 'key'),
    seek(1400, 12.32, 12.28, 'key'),
  ];
  const seeks = selectMoments({ ...base, events: ev, transcript: null }).filter((x) =>
    x.kinds.includes('seek')
  );
  expect(seeks).toHaveLength(1);
  expect(seeks[0].vt).toBe(12.28);
});

it('records zoom state on moments taken while zoomed', () => {
  const m = selectMoments({ ...base, events, transcript });
  const z = m.find((x) => x.kinds.includes('zoom'));
  expect(z?.zoom).toEqual({ scale: 2.5, originX: 0.48, originY: 0.81 });
});

it('caps at 12 moments, keeping clicks before dwells, in time order', () => {
  const ev = Array.from({ length: 20 }, (_, i) => click(i * 1000, (i % 10) / 10 + 0.05, 0.5));
  const m = selectMoments({ ...base, durationMs: 21000, events: ev, transcript: null });
  expect(m).toHaveLength(12);
  expect(m.every((x) => x.kinds.includes('click'))).toBe(true);
  expect(m.map((x) => x.t)).toEqual([...m.map((x) => x.t)].sort((a, b) => a - b));
  expect(m.map((x) => x.id)).toEqual(
    Array.from({ length: 12 }, (_, i) => `moment-${String(i + 1).padStart(2, '0')}`)
  );
});

it('attaches pointer positions to every word', () => {
  const w = wordsWithPointer(transcript, events, 12.4);
  expect(w).toHaveLength(transcript.words.length);
  // The fixture pointer jitters around (0.12, 0.08); the sample at 3.2s is (0.119, 0.082).
  const pointer = w.find((x) => x.word.trim() === 'this')?.pointer;
  expect(pointer?.x).toBeCloseTo(0.12);
  expect(pointer?.y).toBeCloseTo(0.08);
  expect(pointer).toMatchObject({ x: 0.119, y: 0.082, inside: true, vt: 12.4 });
  expect(wordsWithPointer(transcript, events, null).every((x) => x.pointer === null)).toBe(true);
});

it('reads pointer, video time and zoom state at a given time', () => {
  const samples = pointerSamples(events);
  expect(pointerAt(samples, -1)).toBeNull();
  expect(pointerAt(samples, 7850)).toMatchObject({ t: 7800, x: 0.48, y: 0.81 });
  expect(videoTimeAt(events, 4999, 12.4)).toBe(12.4);
  expect(videoTimeAt(events, 5000, 12.4)).toBe(9.0);
  expect(zoomAt(events, 8499)).toBeNull();
  expect(zoomAt(events, 9000)).toEqual({ scale: 2.5, originX: 0.48, originY: 0.81 });
  expect(zoomAt(events, 9500)).toBeNull();
});

it('collapses a scroll-bar drag into one seek moment at the frame it settled on', () => {
  // 40 slider ticks over 2 seconds, the pointer travelling along the bar as it drags.
  const ev: CaptureEvent[] = [];
  for (let i = 0; i < 40; i++) {
    const t = 1000 + i * 50;
    ev.push({ t, type: 'pointer', x: 0.8 - i * 0.015, y: 1.05, inside: false, vt: 2.4 });
    ev.push(seek(t, 2.4 - i * 0.045, 2.4 - (i + 1) * 0.045, 'scrollbar'));
  }
  const final = 2.4 - 40 * 0.045;
  const seeks = selectMoments({
    ...base,
    pausedAtVideoTime: 2.4,
    events: ev,
    transcript: null,
  }).filter((x) => x.kinds.includes('seek'));
  expect(seeks).toHaveLength(1);
  expect(seeks[0].vt).toBeCloseTo(final);
  expect(seeks[0].reasons.filter((r) => r.startsWith('scrolled to'))).toHaveLength(1);
});

it('keeps separate scroll-bar seeks that are more than a second apart', () => {
  const ev = [seek(1000, 12.4, 5, 'scrollbar'), seek(4000, 5, 8, 'scrollbar')];
  const seeks = selectMoments({ ...base, events: ev, transcript: null }).filter((x) =>
    x.kinds.includes('seek')
  );
  expect(seeks.map((s) => s.vt)).toEqual([5, 8]);
});

it('does not repeat the same reason when candidates merge', () => {
  const ev = [click(1000, 0.5, 0.5), click(1100, 0.5, 0.5), click(1200, 0.5, 0.5)];
  const m = selectMoments({ ...base, events: ev, transcript: null });
  const clicked = m.find((x) => x.kinds.includes('click'));
  expect(clicked?.reasons.filter((r) => r === 'click')).toHaveLength(1);
});
