import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { emptyState, poll } from '../scripts/watch-feedback.mjs';
import { giveComment, startReview, state, T } from './helpers';

// An agent can read each comment, stills and all, while the reviewer is still watching: the
// watcher script against the real server, with a reviewer mid-review in the browser.

type Event = {
  type: string;
  reviewerName?: string;
  state?: string;
  transcript?: { text: string } | null;
  local?: Record<string, string>;
};

test('the watcher prints a comment with its stills mid-review, then the Done', async ({ page }) => {
  test.setTimeout(180_000);
  const name = 'Wendy Watcher';
  const images = mkdtempSync(join(tmpdir(), 'watch-e2e-'));
  const events: Event[] = [];
  let watch = emptyState();
  const tick = async () => {
    watch = await poll({
      base: state().baseUrl,
      videoId: state().videoId,
      version: 'latest',
      headers: {},
      state: watch,
      imagesDir: images,
      emit: (e: Event) => events.push(e),
      fetchFn: fetch,
    });
    // Other tests review the same video at the same time: only this reviewer counts.
    return events.filter((e) => e.reviewerName === name);
  };

  try {
    await startReview(page, name);
    await giveComment(page);
    // Still watching: no Done yet.
    await expect(page.getByTestId(T.player)).toBeVisible();

    await expect
      .poll(async () => (await tick()).map((e) => e.type), { timeout: 120_000, intervals: [2000] })
      .toEqual(['comment']);
    const [comment] = events.filter((e) => e.reviewerName === name);
    expect(comment.state).toBe('done');
    const stills = Object.values(comment.local ?? {});
    expect(stills.length).toBeGreaterThanOrEqual(2); // the overview and at least one moment
    for (const file of stills) {
      // A JPEG, saved before the line was printed.
      expect(readFileSync(file).subarray(0, 3).toString('hex')).toBe('ffd8ff');
    }

    await page.getByTestId(T.doneButton).click();
    await expect(page.getByTestId(T.thanks)).toBeVisible();
    await expect
      .poll(async () => (await tick()).map((e) => e.type), { timeout: 30_000, intervals: [1000] })
      .toEqual(['comment', 'session-done']);
  } finally {
    rmSync(images, { recursive: true, force: true });
  }
});
