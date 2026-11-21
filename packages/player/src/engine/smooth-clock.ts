export interface MediaLike {
  currentTime: number;
  paused: boolean;
  seeking: boolean;
  playbackRate: number;
}

/**
 * audio.currentTime updates coarsely in some browsers; extrapolate between updates, never run
 * ahead by more than 250 ms, never step backwards by less than 300 ms (a real seek).
 */
export class SmoothClock {
  private media = 0;
  private wall = 0;
  private last = 0;

  constructor(private now: () => number = () => performance.now()) {}

  read(m: MediaLike): number {
    const wall = this.now();
    if (m.paused || m.seeking || m.currentTime !== this.media) {
      this.media = m.currentTime;
      this.wall = wall;
    }
    let t =
      m.paused || m.seeking
        ? m.currentTime
        : Math.min(this.media + ((wall - this.wall) / 1000) * m.playbackRate, this.media + 0.25);
    if (!m.paused && !m.seeking && t < this.last && this.last - t < 0.3) {
      t = this.last;
    }
    this.last = t;
    return t;
  }
}
