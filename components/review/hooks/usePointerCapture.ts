'use client';

import { type RefObject, useEffect, useRef } from 'react';
import { type DistributiveOmit, pointerToFrame } from '@/lib/capture/eventLog';
import { HOLD_TO_ZOOM_MS } from '@/lib/constants';
import type { CaptureEvent, PlayerInfo, ZoomState } from '@/lib/types';

export type CaptureEventInput = DistributiveOmit<CaptureEvent, 't'>;

export interface PointerCaptureOptions {
  stageRef: RefObject<HTMLElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** The zoom in force right now, or null. */
  getZoom: () => ZoomState | null;
  /** Adds an event to the open comment. Called whether or not one is open: the owner drops it. */
  push: (event: CaptureEventInput) => void;
  /** Called on resize and fullscreen change, before the layout event is pushed. */
  measure: () => PlayerInfo;
}

/** True for pointer events that start on something inside the stage that is not the picture. */
export function isOffPicture(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-no-capture]') !== null;
}

/**
 * Turns what the reviewer does over the picture into capture events: pointer positions (one
 * per animation frame, only when it moved), clicks (a press shorter than the zoom hold),
 * tab and window visibility, and layout changes.
 */
export function usePointerCapture(options: PointerCaptureOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const { stageRef } = options;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let pending: { x: number; y: number } | null = null;
    let raf = 0;
    let down: { at: number; x: number; y: number; button: number } | null = null;

    const locate = (clientX: number, clientY: number) => {
      const o = latest.current;
      const video = o.videoRef.current;
      const zoom = o.getZoom();
      const at = pointerToFrame(
        clientX,
        clientY,
        stage.getBoundingClientRect(),
        { videoWidth: video?.videoWidth ?? 0, videoHeight: video?.videoHeight ?? 0 },
        zoom
      );
      return { ...at, vt: video?.currentTime ?? 0, ...(zoom ? { zoomed: true } : {}) };
    };

    const flush = () => {
      raf = 0;
      if (!pending) return;
      const { x, y } = pending;
      pending = null;
      latest.current.push({ type: 'pointer', ...locate(x, y) });
    };

    const onMove = (e: PointerEvent) => {
      if (isOffPicture(e.target)) return;
      pending = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const onDown = (e: PointerEvent) => {
      if (isOffPicture(e.target)) return;
      down = { at: performance.now(), x: e.clientX, y: e.clientY, button: e.button };
    };

    const onUp = () => {
      const press = down;
      down = null;
      if (!press || performance.now() - press.at >= HOLD_TO_ZOOM_MS) return;
      latest.current.push({
        type: 'click',
        ...locate(press.x, press.y),
        button: press.button,
      });
    };

    const onCancel = () => {
      down = null;
    };

    const onVisibility = () => {
      latest.current.push({
        type: 'visibility',
        state: document.visibilityState === 'hidden' ? 'hidden' : 'visible',
      });
    };
    const onBlur = () => latest.current.push({ type: 'visibility', state: 'blur' });
    const onFocus = () => latest.current.push({ type: 'visibility', state: 'focus' });

    const onLayout = () => {
      const info = latest.current.measure();
      latest.current.push({
        type: 'layout',
        contentRect: info.contentRect,
        containerWidth: info.containerWidth,
        containerHeight: info.containerHeight,
        fullscreen: info.fullscreen,
      });
    };

    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onCancel);
    stage.addEventListener('pointerleave', onCancel);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('resize', onLayout);
    document.addEventListener('fullscreenchange', onLayout);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onCancel);
      stage.removeEventListener('pointerleave', onCancel);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('resize', onLayout);
      document.removeEventListener('fullscreenchange', onLayout);
    };
  }, [stageRef]);
}
