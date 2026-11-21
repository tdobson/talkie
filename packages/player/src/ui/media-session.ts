import type { TalkieFilm } from '@talkie/format';

/** The part of the player the lock screen controls need. */
export interface MediaSessionPlayer extends EventTarget {
  play(): Promise<void>;
  pause(): void;
  currentTime: number;
  readonly duration: number;
  readonly playbackRate: number;
}

const ACTIONS = [
  'play',
  'pause',
  'seekbackward',
  'seekforward',
  'seekto',
  'previoustrack',
  'nexttrack',
] as const;

/** Start of the chapter `step` away from the one playing at `time` (-1 back, 1 on). */
export function chapterStep(film: TalkieFilm, time: number, step: -1 | 1): number | null {
  const starts = film.chapters.map((c) => c.start);
  if (step > 0) {
    return starts.find((s) => s > time + 0.01) ?? null;
  }
  // Like a music player: back goes to the start of this chapter, or the one before if we are
  // already within 3 s of the start.
  const before = starts.filter((s) => s < time - 3);
  return before.length > 0 ? before[before.length - 1]! : starts.length > 0 ? 0 : null;
}

/**
 * Show the film on the lock screen and notification shade, and take play, pause, seek and
 * chapter commands from there. Does nothing where the Media Session API is missing. Returns a
 * function that undoes it.
 */
export function attachMediaSession(
  player: MediaSessionPlayer,
  film: TalkieFilm,
  posterUrl: string | null
): () => void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return () => undefined;
  }
  const session = navigator.mediaSession;

  const chapterTitle = () => {
    let title = '';
    for (const c of film.chapters) {
      if (c.start <= player.currentTime) {
        title = c.title;
      }
    }
    return title;
  };

  let lastArtist: string | null = null;
  const setMetadata = () => {
    const artist = chapterTitle();
    if (artist === lastArtist || typeof MediaMetadata === 'undefined') {
      return;
    }
    lastArtist = artist;
    session.metadata = new MediaMetadata({
      title: film.title,
      artist,
      artwork: posterUrl ? [{ src: posterUrl, type: 'image/png' }] : [],
    });
  };

  const setPosition = () => {
    try {
      session.setPositionState?.({
        duration: film.duration,
        playbackRate: player.playbackRate || 1,
        position: Math.min(Math.max(player.currentTime, 0), film.duration),
      });
    } catch {
      // Browsers reject values they dislike (a zero duration, say). The film still plays.
    }
  };

  const seekBy = (seconds: number) => {
    player.currentTime += seconds;
  };
  const toChapter = (step: -1 | 1) => {
    const time = chapterStep(film, player.currentTime, step);
    if (time !== null) {
      player.currentTime = time;
    }
  };
  const handlers: Record<(typeof ACTIONS)[number], MediaSessionActionHandler> = {
    play: () => void player.play().catch(() => undefined),
    pause: () => player.pause(),
    seekbackward: (d) => seekBy(-(d.seekOffset ?? 10)),
    seekforward: (d) => seekBy(d.seekOffset ?? 10),
    seekto: (d) => {
      if (typeof d.seekTime === 'number') {
        player.currentTime = d.seekTime;
      }
    },
    previoustrack: () => toChapter(-1),
    nexttrack: () => toChapter(1),
  };
  const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // This browser does not know the action.
    }
  };
  for (const action of ACTIONS) {
    setHandler(action, handlers[action]);
  }

  const onTime = () => {
    setMetadata();
    setPosition();
  };
  setMetadata();
  setPosition();
  player.addEventListener('timeupdate', onTime);
  player.addEventListener('ratechange', setPosition);
  player.addEventListener('chapterchange', setMetadata);

  return () => {
    player.removeEventListener('timeupdate', onTime);
    player.removeEventListener('ratechange', setPosition);
    player.removeEventListener('chapterchange', setMetadata);
    for (const action of ACTIONS) {
      setHandler(action, null);
    }
    session.metadata = null;
  };
}
