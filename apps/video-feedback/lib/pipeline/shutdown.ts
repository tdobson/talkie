// A server restart (a deploy, say) stops whatever the pipeline is doing: systemd sends SIGTERM to
// the server and to the ffmpeg it is running. Without this, the killed ffmpeg reads as a failed
// step, the comment is marked failed, and nothing picks it up again. Once the server is shutting
// down, a step that stops is left pending instead, and the startup scan of the next run finishes
// it.

// Kept on globalThis: Next.js can load this module more than once.
const KEY = Symbol.for('video-feedback.shuttingDown');
type Holder = { [KEY]?: boolean };

export function isShuttingDown(): boolean {
  return (globalThis as Holder)[KEY] === true;
}

/** Test seam, and what the signal handlers call. */
export function setShuttingDown(value: boolean): void {
  (globalThis as Holder)[KEY] = value;
}

const WATCHING = Symbol.for('video-feedback.watchingForShutdown');

/**
 * Notes SIGTERM and SIGINT. It only sets the flag: Next.js has its own handlers, which close the
 * server and exit. Listeners run in the order they were added, all before the process exits, and
 * before the killed ffmpeg's exit is seen.
 */
export function watchForShutdown(): void {
  const holder = globalThis as { [WATCHING]?: boolean };
  if (holder[WATCHING]) return;
  holder[WATCHING] = true;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => setShuttingDown(true));
  }
}
