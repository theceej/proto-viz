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

test('exports protocol header code in each supported target', async ({ page }) => {
  await page.goto('/#/library/ipv4');
  await page.getByRole('button', { name: 'Export IPv4 header code' }).click();

  const dialog = page.getByRole('dialog', { name: 'Export IPv4 header code' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Generated protocol code')).toContainText('#pragma once');

  const target = dialog.getByLabel('Target');
  const expected = [
    ['scapy', 'class Ipv4(Packet):'],
    ['rust', 'pub struct Ipv4View'],
    ['wireshark-lua', 'Proto("ipv4"'],
    ['go', 'package ipv4'],
  ] as const;
  for (const [value, source] of expected) {
    await target.selectOption(value);
    await expect(dialog.getByLabel('Generated protocol code')).toContainText(source);
  }
});

test('searches fields and assignments and focuses field results', async ({ page }) => {
  await page.goto('/#/library');
  const search = page.getByRole('searchbox', { name: 'Search protocol library' });

  await search.fill('header checksum');
  const fieldResult = page
    .getByRole('button')
    .filter({ hasText: 'Header Checksum' })
    .filter({ hasText: 'Field' });
  await fieldResult.focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/library\/ipv4\?field=headerChecksum/);
  const panel = page.getByRole('complementary');
  await expect(panel.getByRole('heading', { name: 'IPv4' })).toBeVisible();
  await expect(panel.locator('tr[data-focused="true"]')).toContainText('Header Checksum');
  await expect(panel.locator('tr[data-focused="true"]')).toBeFocused();

  await search.fill('ethertype 0x86dd');
  const assignment = page
    .getByRole('button')
    .filter({ hasText: 'EtherType 34525' })
    .filter({ hasText: 'Assignment' });
  await expect(assignment).toContainText('IPv6 assignment · 0x86dd');
  await assignment.click();
  await expect(panel.getByRole('heading', { name: 'IPv6' })).toBeVisible();

  await search.fill('RFC 8200');
  await expect(
    page.getByRole('button', { name: 'RFC 8200 Reference IPv6 reference', exact: true }),
  ).toBeVisible();
});

test('resizes the protocol detail panel with the keyboard and persists it', async ({
  page,
}) => {
  await page.goto('/#/library/ipv4');
  const panel = page.getByRole('complementary', { name: 'IPv4 protocol details' });
  const handle = page.getByRole('separator', {
    name: 'Resize protocol list and protocol details',
  });
  const before = await panel.evaluate((element) => element.getBoundingClientRect().width);

  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
    .toBe(Math.round(before) + 24);

  await page.reload();
  await expect(panel).toHaveCSS('width', `${Math.round(before) + 24}px`);

  await handle.focus();
  await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute('aria-valuetext', 'Responsive default');
  await expect(panel).toHaveCSS('width', '480px');
});
