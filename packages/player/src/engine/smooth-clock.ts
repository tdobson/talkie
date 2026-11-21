export interface MediaLike {
  currentTime: number;
  paused: boolean;
  seeking: boolean;
  playbackRate: number;
}

/**
 * audio.currentTime updates coarsely in some browsers; extrapolate between updates, never run
 * ahead by more than 250 ms, never step backwards by less than 300 ms (a real seek).
 *
 * After play or a seek the sound takes 0.1 to 0.5 s to start, and currentTime sits still until
 * it does. The clock does not extrapolate until currentTime has moved once, otherwise the
 * picture would run up to 250 ms ahead of the sound at every start.
 */
export class SmoothClock {
  private media = 0;
  private wall = 0;
  private last = 0;
  private moving = false;

  constructor(private now: () => number = () => performance.now()) {}

  read(m: MediaLike): number {
    const wall = this.now();
    if (m.paused || m.seeking) {
      this.moving = false;
      this.media = m.currentTime;
      this.wall = wall;
      this.last = m.currentTime;
      return m.currentTime;
    }
    if (m.currentTime !== this.media) {
      this.moving = true;
      this.media = m.currentTime;
      this.wall = wall;
    }
    let t = this.moving
      ? Math.min(this.media + ((wall - this.wall) / 1000) * m.playbackRate, this.media + 0.25)
      : m.currentTime;
    if (t < this.last && this.last - t < 0.3) {
      t = this.last;
    }
    this.last = t;
    return t;
  }
}
