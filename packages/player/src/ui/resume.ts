const SAVE_EVERY = 5;
const NEAR_END = 5;

/** Storage key for a film: its `src` when it has one, else its title and duration. */
export function resumeKey(src: string | null, film: { title: string; duration: number }): string {
  return `talkie:pos:${src || `${film.title}|${film.duration}`}`;
}

/** localStorage, or null where it is missing or blocked (private mode, sandboxed frames). */
export function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Remembers where the viewer got to in one film. Every storage call may throw, so all are guarded. */
export class Resume {
  private lastSaved: number | null = null;

  constructor(
    private key: string,
    private storage: Storage | null = defaultStorage()
  ) {}

  /** The saved position in seconds, or null. */
  read(): number | null {
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw === null || raw === undefined || raw.trim() === '') {
        return null;
      }
      const time = Number(raw);
      return Number.isFinite(time) && time > 0 ? time : null;
    } catch {
      return null;
    }
  }

  /** Call on timeupdate: saves once the film has moved 5 s from the last save. */
  update(time: number, duration: number): void {
    if (this.lastSaved === null || Math.abs(time - this.lastSaved) >= SAVE_EVERY) {
      this.save(time, duration);
    }
  }

  /** Save now (on pause). Within 5 s of the end the position is cleared instead. */
  save(time: number, duration: number): void {
    if (!Number.isFinite(time) || !Number.isFinite(duration)) {
      return;
    }
    this.lastSaved = time;
    try {
      if (time >= duration - NEAR_END) {
        this.storage?.removeItem(this.key);
      } else {
        this.storage?.setItem(this.key, String(time));
      }
    } catch {
      // Storage is full or blocked. Resume is a nicety, so carry on without it.
    }
  }
}
