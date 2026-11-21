'use client';

import { useEffect, useRef } from 'react';
import type { Screen } from '@/lib/review/machine';

export interface KeyboardOptions {
  screen: Screen;
  /** Arrow keys only step while this is true. */
  paused: boolean;
  /** Seconds per frame of the video. */
  frameDuration: number;
  onToggle: () => void;
  /** Seconds to move by: one frame, or one second with Shift. Negative is backwards. */
  onStep: (delta: number) => void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(target.type);
  }
  return false;
}

const isSpace = (e: KeyboardEvent) => e.key === ' ' || e.code === 'Space';

/**
 * Page-level keys for the player. Space toggles play and pause; the arrows step one frame
 * (one second with Shift) while paused and do nothing during playback. During a general
 * comment space and the arrows do nothing at all. Keys typed into a text field are left alone.
 *
 * Listens in the capture phase and stops the keys it owns from going further, so a focused
 * button is not also pressed by space and a focused scroll bar is not also moved by an arrow.
 */
export function useKeyboard(options: KeyboardOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const active =
    options.screen === 'player' || options.screen === 'end' || options.screen === 'general';

  useEffect(() => {
    if (!active) return;

    const claim = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const o = latest.current;

      if (isSpace(e)) {
        claim(e);
        if (o.screen !== 'general' && !e.repeat) o.onToggle();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        claim(e);
        if (o.screen === 'general' || !o.paused) return;
        const size = e.shiftKey ? 1 : o.frameDuration;
        o.onStep(e.key === 'ArrowLeft' ? -size : size);
      }
    };

    // Browsers press a focused button when space is released, not when it goes down.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (isSpace(e)) claim(e);
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [active]);
}
