import { config } from '@/lib/config';
import { getVideo } from '@/lib/storage/repo';

/** Where an agent reads how to watch a video for feedback. */
export const WATCH_DOCS =
  'https://github.com/tdobson/talkie/blob/main/docs/review-platform-for-agents.md#watch-feedback-while-the-reviewer-is-still-watching';

export interface AfterImport {
  reviewUrl: string;
  /** What an agent that just put a film up should do next. */
  next: string[];
  docs: string;
}

/**
 * What a successful import answers besides its id and version: the review link, and a nudge to
 * start watching for feedback now, while the agent still knows what it is waiting for.
 */
export async function afterImport(videoId: string): Promise<AfterImport | null> {
  const video = await getVideo(videoId);
  if (video === null) return null;
  return {
    reviewUrl: `${config().publicBaseUrl}/r/${video.token}`,
    next: [
      'Give the review link to Tim, not to reviewers.',
      `Start a watcher now, so the feedback reaches you as each comment is made: node apps/video-feedback/scripts/watch-feedback.mjs ${videoId} --state <file> --images <dir>`,
      'It prints one JSON line per finished comment, with its stills saved, and a session-done line when a reviewer presses Done.',
    ],
    docs: WATCH_DOCS,
  };
}
