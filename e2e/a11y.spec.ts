import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { state, T } from './helpers';

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('reviewer screens have no serious axe violations', async ({ page }) => {
  await page.goto(state().reviewUrl);
  await expect(page.getByTestId(T.welcome)).toBeVisible();
  expect(await seriousViolations(page), 'welcome').toEqual([]);

  await page.getByTestId(T.nameInput).fill('Axel Axe');
  await page.getByTestId(T.startButton).click();
  await expect(page.getByTestId(T.micExplain)).toBeVisible();
  expect(await seriousViolations(page), 'mic explain').toEqual([]);

  await page.getByTestId(T.micContinue).click();
  await expect(page.getByTestId(T.micHeard)).toBeVisible({ timeout: 10_000 });
  await page.getByTestId(T.startWatching).click();
  await expect(page.getByTestId(T.player)).toBeVisible();
  expect(await seriousViolations(page), 'player').toEqual([]);

  await page.getByTestId(T.video).evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration - 0.1;
    void v.play();
  });
  await expect(page.getByTestId(T.endScreen)).toBeVisible();
  expect(await seriousViolations(page), 'end').toEqual([]);

  await page.getByTestId(T.endScreen).getByTestId(T.doneButton).click();
  await expect(page.getByTestId(T.thanks)).toBeVisible();
  expect(await seriousViolations(page), 'thanks').toEqual([]);
});
