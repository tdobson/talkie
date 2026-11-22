import { expect, type Page, test } from '@playwright/test';
import { giveComment, readSessionComments, state, T } from './helpers';

/** Welcome and mic explain. From here the mic check runs by itself. */
async function arrive(page: Page, name: string, url: string) {
  await page.goto(url);
  await page.getByTestId(T.nameInput).fill(name);
  await page.getByTestId(T.startButton).click();
  await page.getByTestId(T.micContinue).click();
}

/** The film's position, whichever kind it is: read from the scroll bar, 0..1. */
async function position(page: Page): Promise<number> {
  const now = await page.getByTestId(T.scrollBar).getByRole('slider').getAttribute('aria-valuenow');
  return Number(now) / 10_000;
}

for (const kind of ['mp4', 'talkie'] as const) {
  test(`onboarding: mic check, practice, then the real review (${kind})`, async ({ page }) => {
    const name = `Olive Onboard ${kind}`;
    const url = kind === 'mp4' ? state().reviewUrl : state().talkie.reviewUrl;
    await arrive(page, name, url);

    // 1 and 2: no button; it hears the fake microphone and moves on by itself.
    await expect(page.getByTestId(T.micCheck)).toBeVisible();
    await expect(page.getByTestId(T.startWatching)).toHaveCount(0);
    await expect(page.getByTestId(T.micHeard)).toHaveText('Got you, loud and clear.', {
      timeout: 10_000,
    });
    await expect(page.getByTestId(T.player)).toBeVisible({ timeout: 10_000 });

    // 3: the film starts by itself, with a coach mark on Pause.
    const playPause = page.getByTestId(T.playPause);
    await expect(playPause).toHaveAttribute('aria-label', 'Pause', { timeout: 20_000 });
    await expect(page.getByTestId(T.coachMark)).toContainText('space bar');

    // 4: Give feedback pauses, as Pause does: listening, but this is practice.
    await page.waitForTimeout(700);
    await page.getByTestId(T.giveFeedback).click();
    await expect(page.getByTestId(T.practiceListening)).toBeVisible();
    await expect(page.getByTestId(T.listening)).toHaveCount(0);

    // 5: the fake microphone talks and stops: Got that, then back to the start, playing.
    await expect(page.getByTestId(T.practiceGotThat)).toBeVisible({ timeout: 15_000 });
    await expect(playPause).toHaveAttribute('aria-label', 'Pause', { timeout: 10_000 });
    expect(await position(page)).toBeLessThan(0.4);
    await expect(page.getByTestId(T.coachMark)).toHaveCount(0);

    // 6: the hint fades in after a stretch of playing (2s in the E2E build).
    await expect(page.getByTestId(T.feedbackHint)).toBeVisible({ timeout: 5_000 });

    // The real comment is the only one saved: the practice was thrown away.
    await giveComment(page);
    await expect.poll(async () => (await readSessionComments(name)).length).toBe(1);
    await page.waitForTimeout(1500);
    expect(await readSessionComments(name)).toHaveLength(1);
  });
}
