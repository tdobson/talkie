import { containRect, normalise, unzoom } from '@/lib/geometry';
import type { CaptureEvent, ZoomState } from '@/lib/types';

/** Omit that keeps each member of a union separate. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Collects capture events stamped in whole milliseconds since the recorder started. */
export class EventLog {
  private readonly now: () => number;
  private t0 = 0;
  private pending: CaptureEvent[] = [];

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
    this.t0 = now();
  }

  /** Sets t=0. Call when the recorder reports that it has started. */
  begin(): void {
    this.t0 = this.now();
    this.pending = [];
  }

  push(e: DistributiveOmit<CaptureEvent, 't'>): void {
    const t = Math.max(0, Math.round(this.now() - this.t0));
    this.pending.push({ ...e, t } as CaptureEvent);
  }

  /** Returns and clears the events pushed since the last drain. */
  drain(): CaptureEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }
}

/**
 * Viewport pointer position to full-frame normalised coordinates.
 * `inside` says whether the pointer is over the picture as shown on screen (not the letterbox bars).
 */
export function pointerToFrame(
  clientX: number,
  clientY: number,
  stage: DOMRect,
  video: { videoWidth: number; videoHeight: number },
  zoom: ZoomState | null
): { x: number; y: number; inside: boolean } {
  const content = containRect(stage.width, stage.height, video.videoWidth, video.videoHeight);
  const onScreen = normalise(clientX - stage.left, clientY - stage.top, content);
  const { x, y } = unzoom(onScreen.x, onScreen.y, zoom);
  return { x, y, inside: onScreen.inside };
}
