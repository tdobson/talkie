import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { lowPrioArgv } from '@/lib/media/run';
import { setCommentCompleteHandler } from './enqueue';

// The server side of the processing worker (worker.ts): starts it at the lowest CPU and IO
// priority (nice 19, ionice best effort 7, so the claude broker and every other service on the
// machine come first), passes on "a comment is complete" so it starts at once, and starts it
// again if it ends (a stall, or memory: it is the first process the kernel kills).

/** The worker's V8 heap limit. Images and video live outside it, in sharp and ffmpeg. */
const WORKER_HEAP_MB = 768;
const KEY = Symbol.for('video-feedback.workerHost');
type Holder = { [KEY]?: { child: ChildProcess | null } };

export function workerEntry(): string {
  return join(process.cwd(), 'lib', 'pipeline', 'worker-dist', 'worker.mjs');
}

/** Starts the worker and keeps it running for as long as this server runs. Safe to call twice. */
export function startWorkerHost(log: (m: string) => void = console.log): void {
  const holder = globalThis as Holder;
  if (holder[KEY]) return;
  const state: { child: ChildProcess | null } = { child: null };
  holder[KEY] = state;

  const entry = workerEntry();
  if (!existsSync(entry)) {
    log(`[pipeline] no worker at ${entry}: comments will not be processed (run the build)`);
    return;
  }
  let stopping = false;
  let failures = 0;
  let startedAt = 0;

  const start = () => {
    startedAt = Date.now();
    const [bin, argv] = lowPrioArgv(process.execPath, [
      `--max-old-space-size=${WORKER_HEAP_MB}`,
      entry,
    ]);
    const child = spawn(bin, argv, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    state.child = child;
    child.on('error', (err) => log(`[pipeline] worker could not start: ${err.message}`));
    child.on('exit', (code, signal) => {
      state.child = null;
      if (stopping) return;
      // A worker that ran a good while is restarted at once; one that keeps dying backs off.
      failures = Date.now() - startedAt > 60_000 ? 0 : failures + 1;
      const wait = Math.min(60_000, 2000 * 2 ** failures);
      log(`[pipeline] worker ended (${signal ?? code}); starting another in ${wait / 1000}s`);
      setTimeout(start, wait).unref();
    });
  };

  process.once('SIGTERM', () => {
    stopping = true;
    state.child?.kill('SIGTERM');
  });
  setCommentCompleteHandler(() => kickWorker());
  start();
}

/** Tells the worker to look for work now (a comment completed, or was reprocessed). */
export function kickWorker(): void {
  const child = (globalThis as Holder)[KEY]?.child;
  if (child?.connected) child.send({ type: 'kick' }, () => {});
}
