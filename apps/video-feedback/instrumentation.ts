/**
 * Next.js calls this once when the server starts. In the Node runtime it connects completed
 * uploads to the processing queue and re-queues whatever the last run left unfinished.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Imported here, not at the top, so the Edge build of this file never pulls in node:fs.
  // On SIGTERM (a deploy stopping this slot) Next.js closes the server gracefully, but a
  // connection that keeps being used (the proxy's health check, every second) holds it open
  // until systemd kills it. By then the proxy sends everything to the other slot, and any
  // processing is left pending for it, so exit after a few seconds.
  process.once('SIGTERM', () => {
    setTimeout(() => process.exit(0), 5000).unref();
  });
  const { startPipeline } = await import('@/lib/pipeline/queue');
  // Not awaited: the server serves at once. The pipeline may first wait for another server on
  // the same data (the old release, during a deploy) to stop.
  void startPipeline()
    .then(({ resumed, clips }) => {
      if (resumed + clips > 0) {
        console.log(`[pipeline] resuming ${resumed} comments and ${clips} clips`);
      }
    })
    .catch((err: unknown) => {
      // The server must still serve: completed comments wait on disk as queued.
      console.error('[pipeline] startup failed:', err);
    });
}
