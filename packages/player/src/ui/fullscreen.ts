/** Class put on the host where the Fullscreen API is missing (iPhone Safari). */
export const FALLBACK_CLASS = 'talkie-fullscreen';

type Lockable = { lock?: (orientation: string) => Promise<void>; unlock?: () => void };

function orientation(): Lockable | null {
  return typeof screen !== 'undefined' && screen.orientation
    ? (screen.orientation as unknown as Lockable)
    : null;
}

function lockLandscape(): void {
  try {
    // Rejects on desktops and wherever the platform does not allow it. That is fine.
    void orientation()
      ?.lock?.('landscape')
      ?.catch(() => undefined);
  } catch {
    // Some browsers throw instead of rejecting.
  }
}

function unlock(): void {
  try {
    orientation()?.unlock?.();
  } catch {
    // Nothing was locked.
  }
}

function root(host: HTMLElement): Document | ShadowRoot {
  const node = host.getRootNode();
  return node instanceof ShadowRoot ? node : host.ownerDocument;
}

export function isFullscreen(host: HTMLElement): boolean {
  return root(host).fullscreenElement === host || host.classList.contains(FALLBACK_CLASS);
}

/** Enter fullscreen: the real API where it exists, else a fixed overlay. Locks to landscape if allowed. */
export async function enterFullscreen(host: HTMLElement): Promise<void> {
  if (typeof host.requestFullscreen === 'function') {
    try {
      await host.requestFullscreen();
      lockLandscape();
      return;
    } catch {
      // Refused (no user gesture, or blocked by the embedding page). Use the overlay.
    }
  }
  host.classList.add(FALLBACK_CLASS);
  lockLandscape();
  host.dispatchEvent(new Event('talkiefullscreenchange'));
}

export async function exitFullscreen(host: HTMLElement): Promise<void> {
  unlock();
  if (host.classList.contains(FALLBACK_CLASS)) {
    host.classList.remove(FALLBACK_CLASS);
    host.dispatchEvent(new Event('talkiefullscreenchange'));
    return;
  }
  const doc = host.ownerDocument;
  if (root(host).fullscreenElement === host && typeof doc.exitFullscreen === 'function') {
    try {
      await doc.exitFullscreen();
    } catch {
      // Already left.
    }
  }
}

export function toggleFullscreen(host: HTMLElement): Promise<void> {
  return isFullscreen(host) ? exitFullscreen(host) : enterFullscreen(host);
}

/** Call `onChange` whenever the host enters or leaves fullscreen. Returns the unsubscribe. */
export function watchFullscreen(host: HTMLElement, onChange: () => void): () => void {
  const doc = host.ownerDocument;
  doc.addEventListener('fullscreenchange', onChange);
  host.addEventListener('talkiefullscreenchange', onChange);
  return () => {
    doc.removeEventListener('fullscreenchange', onChange);
    host.removeEventListener('talkiefullscreenchange', onChange);
  };
}
