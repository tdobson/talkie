import { readFileSync } from 'node:fs';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/lib/config';

// Only one server may run the processing pipeline over a data directory. During a deploy two
// run side by side for a moment (the new release is checked before traffic moves to it, and
// the old one is stopped after), and two pipelines would process the same comment twice.
//
// The one that runs it holds `pipeline.lock` in the data directory: its pid and the time the
// process started (from /proc, so a pid reused after a reboot is not mistaken for the holder).
// A server that finds the lock held waits, and takes it as soon as the holder has gone. Until
// then completed comments wait on disk as `queued`, and the startup scan picks them up.

interface Holder {
  pid: number;
  /** Process start time in clock ticks since boot (/proc/<pid>/stat field 22), or null. */
  start: string | null;
}

export const LOCK_NAME = 'pipeline.lock';
// Kept on globalThis: Next.js can load this module more than once.
const HELD = Symbol.for('video-feedback.holdsPipelineLock');
type HeldHolder = { [HELD]?: boolean };

/** True once this process holds the lock (and so runs the pipeline). */
export function holdsLock(): boolean {
  return (globalThis as HeldHolder)[HELD] === true;
}
const lockPath = () => join(/* turbopackIgnore: true */ config().dataDir, LOCK_NAME);

/** When the process started, as Linux records it, or null where there is no /proc. */
function startOf(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The command name (field 2) is in brackets and may hold spaces: count from after it.
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch {
    return null;
  }
}

/** True while the process that wrote `holder` is still running. */
export function holderAlive(holder: Holder): boolean {
  try {
    process.kill(holder.pid, 0);
  } catch {
    // Gone, or (EPERM) a process of another user, so not one of our servers.
    return false;
  }
  if (holder.start === null) return true;
  return startOf(holder.pid) === holder.start;
}

async function readHolder(): Promise<Holder | null> {
  try {
    const v = JSON.parse(await readFile(lockPath(), 'utf8')) as Partial<Holder>;
    return typeof v.pid === 'number' ? { pid: v.pid, start: v.start ?? null } : null;
  } catch {
    return null;
  }
}

/** Takes the lock if it is free or its holder has gone. True when this process now holds it. */
export async function tryTakeLock(pid = process.pid): Promise<boolean> {
  await mkdir(config().dataDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(lockPath(), 'wx');
      await file.writeFile(JSON.stringify({ pid, start: startOf(pid) }));
      await file.close();
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const holder = await readHolder();
    if (holder !== null && holder.pid === pid) return true;
    if (holder !== null && holderAlive(holder)) return false;
    // Left by a server that has gone (or unreadable): clear it and try once more.
    await unlink(lockPath()).catch(() => {});
  }
  return false;
}

/** Gives the lock back if this process holds it. */
export async function releaseLock(pid = process.pid): Promise<void> {
  const holder = await readHolder();
  if (holder?.pid === pid) await unlink(lockPath()).catch(() => {});
}

/**
 * Resolves once this process holds the lock, checking every `everyMs`. Logs once while it
 * waits, so the server log says why nothing is being processed yet.
 */
export async function waitForLock(everyMs = 2000, log = console.log): Promise<void> {
  let said = false;
  for (;;) {
    if (await tryTakeLock()) {
      (globalThis as HeldHolder)[HELD] = true;
      return;
    }
    if (!said) {
      log('[pipeline] another server is processing; waiting for it to stop');
      said = true;
    }
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}
