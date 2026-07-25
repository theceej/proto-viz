import { expect, test } from '@playwright/test';

test('opens with Ctrl+K, filters, and navigates to a view', async ({ page }) => {
  await page.goto('/#/builder');

  await page.locator('body').press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();

  await palette.getByRole('combobox', { name: 'Search commands' }).fill('library');
  const options = palette.getByRole('option');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toHaveText(/Go to Protocol Library/);

  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/#\/library$/);
});

test('runs a builder action from the palette', async ({ page }) => {
  await page.goto('/#/builder');

  await page.locator('body').press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('decode');
  await page.keyboard.press('Enter');

  // The Decode command opened its dialog.
  await expect(page.getByRole('dialog', { name: 'Decode packet bytes' })).toBeVisible();
});

test('closes on Escape', async ({ page }) => {
  await page.goto('/#/builder');
  await page.locator('body').press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});
