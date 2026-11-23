/**
 * Next.js calls this once when the server starts. In the Node runtime it starts the processing
 * worker, which picks up completed uploads and whatever the last run left unfinished.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // On SIGTERM (a deploy stopping this slot) Next.js closes the server gracefully, but a
  // connection that keeps being used (the proxy's health check, every second) holds it open
  // until systemd kills it. By then the proxy sends everything to the other slot, and any
  // processing is left pending for it, so exit after a few seconds.
  process.once('SIGTERM', () => {
    setTimeout(() => process.exit(0), 5000).unref();
  });
  // Comments are processed by a worker process of their own at the lowest priority (see
  // lib/pipeline/worker.ts), never in the server, so the site stays quick while it works.
  // Imported here, not at the top, so the Edge build of this file never pulls in node:fs.
  const { startWorkerHost } = await import('@/lib/pipeline/worker-host');
  startWorkerHost();
}
