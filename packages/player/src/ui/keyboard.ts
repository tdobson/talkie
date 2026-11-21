export interface KeyState {
  currentTime: number;
  /** NaN until a film is loaded. */
  duration: number;
  volume: number;
}

export type KeyAction =
  | { type: 'toggle-play' }
  | { type: 'seek'; time: number }
  | { type: 'volume'; volume: number }
  | { type: 'fullscreen' }
  | { type: 'captions' }
  | { type: 'mute' };

const SKIPS: Record<string, number> = { j: -10, l: 10, arrowleft: -5, arrowright: 5 };

/**
 * What a key press does while the player has focus, given `KeyboardEvent.key`. Pure, so the
 * whole mapping can be tested without a DOM. Returns null for keys the player ignores.
 */
export function keyAction(key: string, state: KeyState): KeyAction | null {
  const k = key.toLowerCase();
  const seek = (time: number): KeyAction | null =>
    Number.isFinite(state.duration)
      ? { type: 'seek', time: Math.min(Math.max(time, 0), state.duration) }
      : null;
  const volume = (step: number): KeyAction => ({
    type: 'volume',
    volume: Math.min(Math.max(Math.round((state.volume + step) * 100) / 100, 0), 1),
  });

  if (k === ' ' || k === 'k') {
    return { type: 'toggle-play' };
  }
  if (k in SKIPS) {
    return seek(state.currentTime + SKIPS[k]!);
  }
  if (k === 'arrowup') {
    return volume(0.1);
  }
  if (k === 'arrowdown') {
    return volume(-0.1);
  }
  if (k === 'f') {
    return { type: 'fullscreen' };
  }
  if (k === 'c') {
    return { type: 'captions' };
  }
  if (k === 'm') {
    return { type: 'mute' };
  }
  if (k === 'home') {
    return seek(0);
  }
  if (k === 'end') {
    return seek(state.duration);
  }
  if (k.length === 1 && k >= '0' && k <= '9') {
    return seek((state.duration * Number(k)) / 10);
  }
  return null;
}
