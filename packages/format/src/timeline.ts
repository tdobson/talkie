import type { TalkieFilm, TalkieScene } from './types';

export interface ScenePosition {
  index: number;
  scene: TalkieScene;
  localTime: number;
}

/** Scene containing film time t. A time exactly on a boundary belongs to the later scene. */
export function sceneAt(film: TalkieFilm, t: number): ScenePosition {
  const s = film.scenes;
  const time = Math.min(Math.max(t, 0), film.duration);
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid]!.start <= time) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const scene = s[lo]!;
  return {
    index: lo,
    scene,
    localTime: Math.min(time - scene.start, scene.end - scene.start),
  };
}

/** Fractional Lottie frame for a scene-local time, clamped to [ip, op - 1]. */
export function frameFor(localTime: number, fr: number, ip: number, op: number): number {
  return Math.min(Math.max(ip + localTime * fr, ip), op - 1);
}

/** Index of the chapter playing at t, or -1 before the first chapter. */
export function chapterAt(film: TalkieFilm, t: number): number {
  let idx = -1;
  for (let i = 0; i < film.chapters.length; i++) {
    if (film.chapters[i]!.start <= t) {
      idx = i;
    }
  }
  return idx;
}
