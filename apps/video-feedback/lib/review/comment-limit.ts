/** Longest gap between two samples that is counted in full. Longer gaps mean a stalled tab. */
const MAX_STEP_MS = 1000;

export interface CommentLimitOptions {
  /** Level, on the meter's 0..1 scale, that counts as speech. */
  threshold: number;
  /** Quiet this long, with the comment still open, ends it. */
  silenceMs: number;
  /** No comment records for longer than this. */
  maxMs: number;
  /** How long before `maxMs` the reviewer is told it is about to end. */
  warnBeforeMs: number;
}

export type CommentLimitState = 'ok' | 'warn' | 'silence' | 'cap';

/**
 * Watches one recording comment so it cannot run for ever: a reviewer who paused and then
 * walked away, or talked to someone else in the room, would otherwise be recorded until the
 * tab closed. Fed the live level with a timestamp; pure, so the same input always gives the
 * same answer. Once it says `silence` or `cap` it stays there.
 */
export class CommentLimit {
  private readonly o: CommentLimitOptions;
  private readonly start: number;
  private quietSince: number;
  private last: number;
  private ended: 'silence' | 'cap' | null = null;

  constructor(options: CommentLimitOptions, start: number) {
    this.o = options;
    this.start = start;
    this.quietSince = start;
    this.last = start;
  }

  update(level: number, now: number): CommentLimitState {
    if (this.ended) return this.ended;
    // A stalled tab (asleep, in the background) does not count its gap as quiet.
    if (now - this.last > MAX_STEP_MS) this.quietSince += now - this.last - MAX_STEP_MS;
    this.last = now;
    if (level >= this.o.threshold) this.quietSince = now;
    if (now - this.start >= this.o.maxMs) this.ended = 'cap';
    else if (now - this.quietSince >= this.o.silenceMs) this.ended = 'silence';
    if (this.ended) return this.ended;
    return now - this.start >= this.o.maxMs - this.o.warnBeforeMs ? 'warn' : 'ok';
  }
}
