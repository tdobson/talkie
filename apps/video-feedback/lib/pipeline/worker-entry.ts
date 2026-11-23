// Entry point of the processing worker process (see worker.ts). Built into
// lib/pipeline/worker-dist/worker.mjs by worker-build.ts and started by the server
// (worker-host.ts) at the lowest CPU and IO priority.
import { writeFileSync } from 'node:fs';
import { runWorker } from './worker';

// First to go if memory runs short: the server, and anything else on the machine, matter more.
try {
  writeFileSync('/proc/self/oom_score_adj', '1000');
} catch {
  // Not Linux, or not allowed: carry on.
}

// Stopping (a deploy, or the server going down): a step cut off now is left pending, not
// failed (shutdown.ts notes the signal), and the next worker carries on with it. Give that a
// moment, then go: nothing else here ends the process on a signal.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => setTimeout(() => process.exit(0), 2000).unref());
}

// The server that started us has gone (killed outright, so it could not stop us): stop too,
// or this process would hold the pipeline lock and nobody else could process.
const parent = process.ppid;
setInterval(() => {
  if (process.ppid !== parent) process.exit(0);
}, 2000).unref();

const worker = await runWorker();
console.log(`[pipeline] worker ${process.pid} running`);
process.on('message', (m: unknown) => {
  if ((m as { type?: string } | null)?.type === 'kick') worker.kick();
});
process.on('disconnect', () => process.exit(0));
