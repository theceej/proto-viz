import { expect, test } from '@playwright/test';

test('hex view uses 8-byte rows at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/#/builder');
  await expect(page.locator('main')).toBeVisible();
  await page.getByRole('tab', { name: 'Hex dump' }).click();
  // First hex row group spans 8 bytes (0 through 7), not 16.
  await expect(page.getByRole('group', { name: /^Hex bytes 0 through 7$/ })).toBeVisible();
});

test('hex view uses 16-byte rows on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#/builder');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('group', { name: /^Hex bytes 0 through 15$/ }).first()).toBeVisible();
});
