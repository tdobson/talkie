import { expect, type Page, test } from '@playwright/test';
import { continueMic, giveComment, readSessionComments, state, T } from './helpers';

/** The film's position, whichever kind it is: read from the scroll bar, 0..1. */
async function position(page: Page): Promise<number> {
  const now = await page.getByTestId(T.scrollBar).getByRole('slider').getAttribute('aria-valuenow');
  return Number(now) / 10_000;
}

for (const kind of ['mp4', 'talkie'] as const) {
  test(`onboarding: once per browser, then straight to the film (${kind})`, async ({ page }) => {
    const name = `Olive Onboard ${kind}`;
    const url = kind === 'mp4' ? state().reviewUrl : state().talkie.reviewUrl;
    const other = kind === 'mp4' ? state().talkie.reviewUrl : state().reviewUrl;

    // First visit in this browser: the name, then the microphone.
    await page.goto(url);
    await page.getByTestId(T.nameInput).fill(name);
    await page.getByTestId(T.startButton).click();
    await continueMic(page);

    // Hello: no button; it hears the fake microphone and moves on by itself.
    await expect(page.getByTestId(T.micCheck)).toBeVisible();
    await expect(page.getByTestId(T.startWatching)).toHaveCount(0);
    await expect(page.getByTestId(T.micHeard)).toHaveText('Got you, loud and clear.', {
      timeout: 10_000,
    });

    // The practice: a card says what it is and how feedback works, under a practice banner.
    await expect(page.getByTestId(T.player)).toBeVisible({ timeout: 10_000 });
    const playPause = page.getByTestId(T.playPause);
    await expect(page.getByTestId(T.practiceIntro)).toContainText('First, a quick practice');
    await expect(page.getByTestId(T.practiceIntro)).toContainText('pause it and talk');
    await expect(page.getByTestId(T.practiceBanner)).toContainText('not your film');
    await expect(playPause).toHaveAttribute('aria-label', 'Play');
    // It practises on a short clip of its own, not the film under review.
    await expect(page.getByTestId(T.video)).toHaveAttribute('src', '/practice/clip.mp4');

    // Start practice plays it, and the coach mark says to pause now.
    await page.getByTestId(T.practiceStart).click();
    await expect(playPause).toHaveAttribute('aria-label', 'Pause', { timeout: 20_000 });
    await expect(page.getByTestId(T.coachMark)).toContainText('Now press pause');
    await page.waitForTimeout(700);

    // Give feedback pauses, as Pause does: listening, but this is practice.
    await page.getByTestId(T.giveFeedback).click();
    await expect(page.getByTestId(T.practiceListening)).toContainText('say something');
    await expect(page.getByTestId(T.listening)).toHaveCount(0);

    // As soon as it hears them: Got that, then the real film from the start, playing.
    await expect(page.getByTestId(T.practiceGotThat)).toContainText('Now for real', {
      timeout: 15_000,
    });
    await expect(playPause).toHaveAttribute('aria-label', 'Pause', { timeout: 20_000 });
    // The real film now: a video has its own src, a film's surface none at all.
    await expect(page.getByTestId(T.video)).not.toHaveAttribute('src', '/practice/clip.mp4');
    expect(await position(page)).toBeLessThan(0.4);
    await expect(page.getByTestId(T.coachMark)).toHaveCount(0);
    await expect(page.getByTestId(T.practiceBanner)).toHaveCount(0);

    // The hint fades in after a stretch of playing (2s in the E2E build).
    await expect(page.getByTestId(T.feedbackHint)).toBeVisible({ timeout: 5_000 });

    // The real comment is the only one saved: the practice was thrown away.
    await giveComment(page);
    await expect.poll(async () => (await readSessionComments(name)).length).toBe(1);

    // Another film, same browser: no name to type, no hello, no practice.
    await page.goto(other);
    await expect(page.getByTestId(T.welcomeBack)).toContainText(`Welcome back, ${name}.`);
    await expect(page.getByTestId(T.nameInput)).toHaveCount(0);
    await page.getByTestId(T.startButton).click();
    await continueMic(page);
    await expect(page.getByTestId(T.player)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(T.micCheck)).toHaveCount(0);
    await expect(page.getByTestId(T.practiceIntro)).toHaveCount(0);
    await expect(page.getByTestId(T.practiceBanner)).toHaveCount(0);
    await giveComment(page);
    await expect.poll(async () => (await readSessionComments(name)).length).toBe(2);
  });
}

test('someone else at the same computer gives their own name', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vf:reviewer',
      JSON.stringify({ name: 'Pat Previous', micChecked: true, practised: true })
    );
  });
  await page.goto(state().reviewUrl);
  await expect(page.getByTestId(T.welcomeBack)).toContainText('Welcome back, Pat Previous.');
  await page.getByTestId(T.notMe).click();
  await page.getByTestId(T.nameInput).fill('Nell Newname');
  await page.getByTestId(T.startButton).click();
  await continueMic(page);
  await expect(page.getByTestId(T.player)).toBeVisible({ timeout: 10_000 });
  await giveComment(page);
  await expect.poll(async () => (await readSessionComments('Nell Newname')).length).toBe(1);
});
