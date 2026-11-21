import type { TalkieFilm } from '@talkie/format';
import { sliderValueText } from './format-time';

export interface Segment {
  start: number;
  end: number;
  title: string;
}

/**
 * The film cut into scrub-bar segments, one per chapter. Time before the first chapter gets
 * its own untitled segment, and a film with no chapters is one segment.
 */
export function chapterSegments(film: TalkieFilm): Segment[] {
  const starts = film.chapters
    .filter((c) => c.start < film.duration)
    .map((c) => ({ start: Math.max(c.start, 0), title: c.title }))
    .sort((a, b) => a.start - b.start);
  if (starts.length === 0 || starts[0]!.start > 0) {
    starts.unshift({ start: 0, title: '' });
  }
  return starts
    .map((s, i) => ({ ...s, end: starts[i + 1]?.start ?? film.duration }))
    .filter((s) => s.end > s.start);
}

/** How much of [start, end] the range [from, to] covers, as a fraction from 0 to 1. */
function cover(start: number, end: number, to: number): number {
  return Math.min(Math.max((to - start) / (end - start), 0), 1);
}

export interface ScrubberHandlers {
  /** The viewer chose a time (click, drag or key). `final` is false while a drag is under way. */
  onSeek(time: number, final: boolean): void;
  /** The pointer is over the bar at `time`; `fraction` is how far along the bar, 0 to 1. */
  onHover(time: number, fraction: number): void;
  onHoverEnd(): void;
}

/** The scrub bar: chapter segments with gaps, buffered and played fills, drag and keys. */
export class Scrubber {
  private duration = 0;
  private time = 0;
  private segments: Array<Segment & { played: HTMLElement; buffered: HTMLElement }> = [];
  private dragging = false;

  constructor(
    private el: HTMLElement,
    private track: HTMLElement,
    private thumb: HTMLElement,
    private handlers: ScrubberHandlers
  ) {
    el.addEventListener('pointerdown', this.onPointerDown as EventListener);
    el.addEventListener('pointermove', this.onPointerMove as EventListener);
    el.addEventListener('pointerup', this.onPointerUp as EventListener);
    el.addEventListener('pointercancel', this.onPointerUp as EventListener);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('keydown', this.onKeyDown);
    // A click on the bar must not reach the stage's click handler.
    el.addEventListener('click', (event) => event.stopPropagation());
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  setFilm(film: TalkieFilm | null): void {
    this.duration = film ? film.duration : 0;
    this.track.replaceChildren();
    this.segments = (film ? chapterSegments(film) : []).map((segment) => {
      const box = document.createElement('div');
      box.className = 'segment';
      box.style.flex = `${segment.end - segment.start} 1 0`;
      const buffered = document.createElement('div');
      buffered.className = 'buffered';
      const played = document.createElement('div');
      played.className = 'played';
      box.append(buffered, played);
      this.track.append(box);
      return { ...segment, played, buffered };
    });
    this.el.setAttribute('aria-valuemax', String(this.duration));
    this.update(0, null);
  }

  /** Move the fill and thumb to `time`, and show how much audio has loaded. */
  update(time: number, buffered: TimeRanges | null): void {
    this.time = time;
    let loaded = 0;
    if (buffered) {
      // Show the loaded range the playhead is in: that is the one that matters to the viewer.
      for (let i = 0; i < buffered.length; i++) {
        if (buffered.start(i) <= time + 0.5 && buffered.end(i) > loaded) {
          loaded = buffered.end(i);
        }
      }
    }
    for (const s of this.segments) {
      s.played.style.width = `${cover(s.start, s.end, time) * 100}%`;
      s.buffered.style.width = `${cover(s.start, s.end, loaded) * 100}%`;
    }
    const fraction = this.duration > 0 ? Math.min(Math.max(time / this.duration, 0), 1) : 0;
    this.thumb.style.left = `${fraction * 100}%`;
    this.el.setAttribute('aria-valuenow', String(Math.round(time * 10) / 10));
    this.el.setAttribute('aria-valuetext', sliderValueText(time, this.duration));
  }

  private at(event: PointerEvent): { time: number; fraction: number } {
    const rect = this.el.getBoundingClientRect();
    const fraction =
      rect.width > 0 ? Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1) : 0;
    return { time: fraction * this.duration, fraction };
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.duration <= 0 || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    this.dragging = true;
    this.el.setAttribute('data-dragging', '');
    try {
      this.el.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events have no active pointer to capture.
    }
    const { time, fraction } = this.at(event);
    this.handlers.onHover(time, fraction);
    this.handlers.onSeek(time, false);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.duration <= 0) {
      return;
    }
    const { time, fraction } = this.at(event);
    this.handlers.onHover(time, fraction);
    if (this.dragging) {
      this.handlers.onSeek(time, false);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    this.el.removeAttribute('data-dragging');
    this.handlers.onSeek(this.at(event).time, true);
    if (event.pointerType !== 'mouse') {
      this.handlers.onHoverEnd();
    }
  };

  private onPointerLeave = (): void => {
    if (!this.dragging) {
      this.handlers.onHoverEnd();
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.duration <= 0 || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const steps: Record<string, number> = {
      ArrowLeft: -5,
      ArrowDown: -5,
      ArrowRight: 5,
      ArrowUp: 5,
      PageDown: -10,
      PageUp: 10,
      Home: -Infinity,
      End: Infinity,
    };
    const step = steps[event.key];
    if (step === undefined) {
      return;
    }
    // The slider handles its own arrows, so the player's shortcuts must not act on them too.
    event.preventDefault();
    event.stopPropagation();
    this.handlers.onSeek(Math.min(Math.max(this.time + step, 0), this.duration), true);
  };
}
