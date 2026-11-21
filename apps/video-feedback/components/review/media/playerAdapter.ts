import type { MediaAdapter, MediaAdapterEvent } from './adapter';

/**
 * What the player needs from the media beyond the MediaAdapter contract. Both adapters
 * implement it, so the player and its hooks never touch a `<video>` element or an engine.
 *
 * Two events are added to the contract's: `buffering` (a CustomEvent whose detail is true while
 * the picture is waiting for data and false once it is ready again) and `scenewarning` (a
 * CustomEvent with detail `{ sceneId }`, Talkie only: a scene could not be loaded).
 */
export interface PlayerAdapter extends MediaAdapter {
  /** True while the media itself cannot be loaded or decoded. */
  readonly failed: boolean;
  /** 0..1. Zero also mutes. */
  setVolume(volume: number): void;
  /**
   * The time one frame away from the current time. Not clamped to the media: the caller does
   * that. For a film this stops at the first frame of the next scene instead of stepping over it.
   */
  stepFrame(direction: 1 | -1): number;
}

export type PlayerAdapterEvent = MediaAdapterEvent | 'buffering' | 'scenewarning';

export interface SceneWarningDetail {
  sceneId: string;
}
