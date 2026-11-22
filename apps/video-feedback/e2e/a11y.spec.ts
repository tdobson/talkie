import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { state, T } from './helpers';

/**
 * Screens fade in. Axe blends colours through opacity, so a check mid-fade reports contrast
 * that the finished screen does not have: wait until the screen is fully opaque.
 */
async function settled(page: Page, testId: string): Promise<void> {
  await expect
    .poll(() =>
      page.getByTestId(testId).evaluate((el) => {
        let opacity = 1;
        for (let n: Element | null = el; n; n = n.parentElement) {
          opacity *= Number(getComputedStyle(n).opacity);
        }
        return opacity;
      })
    )
    .toBe(1);
}

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('reviewer screens have no serious axe violations', async ({ page }) => {
  await page.goto(state().reviewUrl);
  await expect(page.getByTestId(T.welcome)).toBeVisible();
  await settled(page, T.welcome);
  expect(await seriousViolations(page), 'welcome').toEqual([]);

  await page.getByTestId(T.nameInput).fill('Axel Axe');
  await page.getByTestId(T.startButton).click();
  await expect(page.getByTestId(T.micExplain)).toBeVisible();
  await settled(page, T.micExplain);
  expect(await seriousViolations(page), 'mic explain').toEqual([]);

  await page.getByTestId(T.micContinue).click();
  await expect(page.getByTestId(T.micHeard)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(T.player)).toBeVisible();
  // The practice run's coach mark is up: it is checked with the player.
  await expect(page.getByTestId(T.coachMark)).toBeVisible();
  await settled(page, T.player);
  expect(await seriousViolations(page), 'player').toEqual([]);

  await page.getByTestId(T.video).evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration - 0.1;
    void v.play();
  });
  await expect(page.getByTestId(T.endScreen)).toBeVisible();
  await settled(page, T.endScreen);
  expect(await seriousViolations(page), 'end').toEqual([]);

  await page.getByTestId(T.endScreen).getByTestId(T.doneButton).click();
  await expect(page.getByTestId(T.thanks)).toBeVisible();
  await settled(page, T.thanks);
  expect(await seriousViolations(page), 'thanks').toEqual([]);
});
