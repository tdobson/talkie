/**
 * Next.js calls this once when the server starts. In the Node runtime it connects completed
 * uploads to the processing queue and re-queues whatever the last run left unfinished.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Imported here, not at the top, so the Edge build of this file never pulls in node:fs.
  const { startPipeline } = await import('@/lib/pipeline/queue');
  try {
    const { resumed, clips } = await startPipeline();
    if (resumed + clips > 0) {
      console.log(`[pipeline] resuming ${resumed} comments and ${clips} clips`);
    }
  } catch (err) {
    // The server must still start: new comments are queued as they complete.
    console.error('[pipeline] startup scan failed:', err);
  }
}
