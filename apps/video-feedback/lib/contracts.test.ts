import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { T } from '@/lib/testids';
import { MORE_T, moreCopy } from '@/lib/review/additions';
import { copy } from '@/lib/review/copy';
import { notifyCommentComplete, setCommentCompleteHandler } from '@/lib/pipeline/enqueue';

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (typeof v === 'function') return [String((v as (s: string) => string)('X'))];
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}
const fx = (n: string) => JSON.parse(readFileSync(join(__dirname, '../test/fixtures', n), 'utf8'));

describe('contracts', () => {
  it('test ids are unique', () => {
    const vals = Object.values(T);
    expect(new Set(vals).size).toBe(vals.length);
  });
  it('reviewer copy has no em-dashes', () => {
    for (const s of strings(copy)) expect(s).not.toContain('—');
  });
  it('the added copy has no em-dashes or timecodes, and the added test ids clash with nothing', () => {
    for (const text of strings(moreCopy)) {
      expect(text).not.toContain('—');
      expect(text).not.toMatch(/\d+:\d{2}/);
    }
    const ids = [...Object.values(T), ...Object.values(MORE_T)];
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('copy functions interpolate', () => {
    expect(copy.pageTitle('Promo')).toBe('Feedback: Promo');
    expect(copy.thanks.title('Sarah')).toBe('Thanks, Sarah.');
  });
  it('enqueue forwards to the handler and is a no-op without one', () => {
    const ref = { videoId: 'v', sessionId: 's', commentId: 'c' };
    setCommentCompleteHandler(null);
    expect(() => notifyCommentComplete(ref)).not.toThrow();
    const h = vi.fn();
    setCommentCompleteHandler(h);
    notifyCommentComplete(ref);
    expect(h).toHaveBeenCalledWith(ref);
    setCommentCompleteHandler(null);
  });
  it('events fixture matches the plan', () => {
    const ev = fx('events-basic.json') as Array<Record<string, unknown>>;
    const ts = ev.map((e) => e.t as number);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    const rest = ev.filter(
      (e) => e.type === 'pointer' && (e.t as number) >= 2800 && (e.t as number) <= 3900
    );
    expect(rest.length).toBeGreaterThan(0);
    for (const p of rest) {
      expect(p.x).toBeCloseTo(0.12, 2);
      expect(p.y).toBeCloseTo(0.08, 2);
    }
    expect(ev.some((e) => e.type === 'click' && e.t === 7800)).toBe(true);
    expect(ev.some((e) => e.type === 'seek' && e.t === 5000)).toBe(true);
    expect(ev.filter((e) => String(e.type).startsWith('zoom')).length).toBeGreaterThanOrEqual(2);
  });
  it('transcript fixture has deictic words at the planned times', () => {
    const tr = fx('transcript-basic.json') as { words: { word: string; start: number }[] };
    expect(tr.words.find((w) => w.word === 'this')?.start).toBe(3.2);
    expect(tr.words.find((w) => w.word === 'here')?.start).toBe(7.8);
  });
});
