import { expect, test } from '@playwright/test';

test('switches the library between layer grouping and a flat A–Z list', async ({ page }) => {
  await page.goto('/#/library');

  // Default: grouped by layer, with layer headings and a usable OSI button.
  await expect(page.getByRole('heading', { name: 'Link layer' })).toBeVisible();
  const osi = page.getByRole('button', { name: 'OSI model' });
  await expect(osi).toBeEnabled();

  // Switch to A–Z: layer headings disappear and the OSI button is disabled.
  await page.getByRole('button', { name: 'A–Z' }).click();
  await expect(page.getByRole('heading', { name: 'Link layer' })).toHaveCount(0);
  await expect(osi).toBeDisabled();

  // The preference persists across a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: 'A–Z' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Link layer' })).toHaveCount(0);

  // Back to Layer restores the grouped view and re-enables OSI.
  await page.getByRole('button', { name: 'Layer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Link layer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'OSI model' })).toBeEnabled();
});

test('shows merged protocol references in a dedicated section', async ({ page }) => {
  await page.goto('/#/library/bfd');
  const panel = page.getByRole('complementary');

  await expect(panel.getByRole('heading', { name: 'BFD' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'References' })).toBeVisible();
  await expect(panel.getByRole('listitem')).toHaveCount(2);
  await expect(panel.getByRole('link', { name: 'RFC 5880' })).toHaveAttribute(
    'href',
    'https://www.rfc-editor.org/rfc/rfc5880',
  );
  await expect(panel.getByRole('link', { name: 'RFC 5881' })).toHaveAttribute(
    'href',
    'https://www.rfc-editor.org/rfc/rfc5881',
  );
});
