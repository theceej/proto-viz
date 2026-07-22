import { expect, test } from '@playwright/test';

test('builder panes become tabs at 375px, stay split on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/#/builder');
  await expect(page.locator('main')).toBeVisible();

  // Narrow: a single tabbed pane, not three side-by-side.
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(['Field editor', 'Packet diagrams', 'Hex dump']);
  // Default tab is the diagrams; switch to the hex tab.
  await page.getByRole('tab', { name: 'Hex dump' }).click();
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-label', 'Hex dump');
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(0);
});

test('scenario panes become tabs at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/#/scenario');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveText(['Field editor', 'Packet diagrams', 'Hex dump']);
});

test('desktop keeps the three resizable panes (no tabs)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#/builder');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Field editor' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Hex dump' })).toBeVisible();
});
