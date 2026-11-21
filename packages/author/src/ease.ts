import type { Ease } from './model';

export const HANDLES: Record<Ease, { o: [number, number]; i: [number, number] }> = {
  linear: { o: [0, 0], i: [1, 1] },
  in: { o: [0.42, 0], i: [1, 1] },
  out: { o: [0, 0], i: [0.58, 1] },
  inOut: { o: [0.42, 0], i: [0.58, 1] },
};

/** y for x on the cubic bezier (0,0) o i (1,1), solved by bisection (deterministic, 30 iterations). */
export function easeAt(ease: Ease, x: number): number {
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  const { o, i } = HANDLES[ease];
  const bx = (t: number) => 3 * (1 - t) ** 2 * t * o[0] + 3 * (1 - t) * t ** 2 * i[0] + t ** 3;
  const by = (t: number) => 3 * (1 - t) ** 2 * t * o[1] + 3 * (1 - t) * t ** 2 * i[1] + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let n = 0; n < 30; n++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < x) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return by((lo + hi) / 2);
}
