/** Longest gap between two samples that is counted in full. Longer gaps mean a stalled tab. */
const MAX_STEP_MS = 200;

export interface PracticeListenerOptions {
  /** Level, on the meter's 0..1 scale, that counts as speech. */
  threshold: number;
  /** Speech, in total, needed before a quiet spell can end it. */
  speechMs: number;
  /** Quiet after that speech that ends it. */
  silenceMs: number;
}

/**
 * Listens to the practice comment: done once the reviewer has spoken for `speechMs` in all and
 * then gone quiet for `silenceMs`. Fed the live level with a timestamp; pure, so it gives the
 * same answer for the same input every time.
 */
export class PracticeListener {
  private readonly o: PracticeListenerOptions;
  private last: number | null = null;
  private speech = 0;
  private quietSince: number | null = null;
  private done = false;

  constructor(options: PracticeListenerOptions) {
    this.o = options;
  }

  update(level: number, now: number): boolean {
    if (this.done) return true;
    const step = this.last === null ? 0 : Math.min(Math.max(now - this.last, 0), MAX_STEP_MS);
    this.last = now;
    if (level >= this.o.threshold) {
      this.speech += step;
      this.quietSince = null;
      return false;
    }
    if (this.speech < this.o.speechMs) return false;
    this.quietSince ??= now;
    this.done = now - this.quietSince >= this.o.silenceMs;
    return this.done;
  }
}
