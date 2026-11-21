'use client';

import { type RefObject, useEffect, useRef } from 'react';
import { pointerToFrame } from '@/lib/capture/eventLog';
import { HOLD_TO_ZOOM_MS, ZOOM_SCALE } from '@/lib/constants';
import type { ZoomState } from '@/lib/types';
import type { MediaAdapter } from '../media/adapter';
import { isOffPicture, pictureSize } from './usePointerCapture';

export interface HoldToZoomOptions {
  stageRef: RefObject<HTMLElement | null>;
  /** The media being shown: its picture size, and for pointer events its current time. */
  adapterRef: RefObject<MediaAdapter | null>;
  /** Zoom is only offered while paused on the player. Turning this off ends any zoom. */
  enabled: boolean;
  onStart: (zoom: ZoomState) => void;
  onPan: (originX: number, originY: number) => void;
  /** Called with the zoom as it was when the hold ended. */
  onEnd: (last: ZoomState) => void;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Press and hold on the picture for HOLD_TO_ZOOM_MS to zoom in around the pointer. While held
 * the zoom origin follows the pointer; letting go, or leaving the picture area, zooms back out.
 * The origin is the pointer's position on the unzoomed picture, 0..1 on each axis.
 */
export function useHoldToZoom(options: HoldToZoomOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const { stageRef, enabled } = options;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = { x: 0, y: 0 };
    let zoom: ZoomState | null = null;

    const originAt = (clientX: number, clientY: number) => {
      const at = pointerToFrame(
        clientX,
        clientY,
        stage.getBoundingClientRect(),
        pictureSize(latest.current.adapterRef.current),
        null
      );
      return { originX: clamp01(at.x), originY: clamp01(at.y) };
    };

    const cancelTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const pan = () => {
      if (!zoom) return;
      const next = originAt(last.x, last.y);
      if (next.originX === zoom.originX && next.originY === zoom.originY) return;
      zoom = { ...zoom, ...next };
      latest.current.onPan(next.originX, next.originY);
    };

    const end = () => {
      cancelTimer();
      if (!zoom) return;
      const was = zoom;
      zoom = null;
      latest.current.onEnd(was);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || isOffPicture(e.target)) return;
      last = { x: e.clientX, y: e.clientY };
      cancelTimer();
      timer = setTimeout(() => {
        timer = null;
        zoom = { scale: ZOOM_SCALE, ...originAt(last.x, last.y) };
        latest.current.onStart(zoom);
      }, HOLD_TO_ZOOM_MS);
    };

    // Not throttled: the pan must be logged before the pointer position that follows it,
    // which usePointerCapture sends on the next animation frame.
    const onMove = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      pan();
    };

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('pointerleave', end);
    // A release outside the window never reaches the stage.
    window.addEventListener('blur', end);

    return () => {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', end);
      stage.removeEventListener('pointercancel', end);
      stage.removeEventListener('pointerleave', end);
      window.removeEventListener('blur', end);
      end();
    };
  }, [stageRef, enabled]);
}
