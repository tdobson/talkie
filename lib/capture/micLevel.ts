/** Root mean square of time-domain samples (each -1..1), clamped to 0..1. */
export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length));
}

/** Opens once the level has stayed at or above the threshold for holdMs, then stays open. */
export class SpeechGate {
  private since: number | null = null;
  private open = false;
  private readonly threshold: number;
  private readonly holdMs: number;

  constructor(threshold: number, holdMs: number) {
    this.threshold = threshold;
    this.holdMs = holdMs;
  }

  update(level: number, now: number): boolean {
    if (this.open) return true;
    if (level < this.threshold) {
      this.since = null;
      return false;
    }
    if (this.since === null) this.since = now;
    this.open = now - this.since >= this.holdMs;
    return this.open;
  }

  reset(): void {
    this.since = null;
    this.open = false;
  }
}
