/**
 * Next.js calls this once when the server starts. In the Node runtime it starts the processing
 * worker, which picks up completed uploads and whatever the last run left unfinished.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Comments are processed by a worker process of their own at the lowest priority (see
  // lib/pipeline/worker.ts), never in the server, so the site stays quick while it works.
  // Imported here, not at the top, so the Edge build of this file never pulls in node:fs.
  const { exitSoonAfterSigterm, startWorkerHost } = await import('@/lib/pipeline/worker-host');
  exitSoonAfterSigterm();
  startWorkerHost();
}
