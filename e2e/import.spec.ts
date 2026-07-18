import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('imports a text RFC through the review workflow', async ({ page }) => {
  await page.goto('/#/import');
  const fixture = fileURLToPath(new URL('../fixtures/rfc768-udp.txt', import.meta.url));
  await page.locator('input[type="file"]').setInputFiles(fixture);

  await expect(page.getByText(/diagram detected/)).toBeVisible();
  await page.getByRole('button', { name: /Diagram at line/ }).first().click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Protocol name')).toHaveValue('rfc768-udp');
  await expect(page.getByRole('button', { name: 'Save to library' })).toBeEnabled();
});
