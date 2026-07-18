import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function loadTcpPreset(page: Page) {
  await page.goto('/#/builder');
  await page.getByRole('button', { name: 'Presets' }).click();
  await page.getByRole('button', { name: /TCP over Ethernet/ }).click();
}

test('builds a stack, edits a field, and updates the hex view', async ({ page }) => {
  await page.goto('/#/builder');
  for (const protocol of ['TCP', 'IPv4', 'Ethernet II']) {
    await page.getByRole('button', { name: `Remove ${protocol} layer` }).click();
  }
  for (const protocol of ['Ethernet II', 'IPv4', 'TCP']) {
    const addLayer = page.getByRole('button', { name: 'Add layer' });
    await addLayer.click();
    await addLayer.locator('..').getByRole('button', { name: new RegExp(`^${protocol}`) }).click();
  }

  await expect(page.getByRole('button', { name: 'Reorder Ethernet II layer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reorder IPv4 layer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reorder TCP layer' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Source MAC', exact: true }).fill('aa:bb:cc:dd:ee:ff');
  await expect(page.getByLabel(/Byte offset 6 .*value 0xaa/)).toBeVisible();
});

test('undoes a grouped field edit and redoes it', async ({ page }) => {
  await loadTcpPreset(page);
  const sourceMac = page.getByRole('textbox', { name: 'Source MAC', exact: true });
  const original = await sourceMac.inputValue();

  await sourceMac.fill('aa:bb:cc:dd:ee:00');
  await sourceMac.fill('aa:bb:cc:dd:ee:ff');
  await page.keyboard.press('Control+z');
  await expect(sourceMac).toHaveValue(original);

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(sourceMac).toHaveValue('aa:bb:cc:dd:ee:ff');
});

test('adds a structured TCP MSS option and updates Data Offset', async ({ page }) => {
  await loadTcpPreset(page);
  await page.getByRole('checkbox', { name: 'MSS' }).check();
  await page.getByRole('spinbutton', { name: 'MSS value' }).fill('1460');
  await expect(page.getByLabel(/Byte offset 46 .*value 0x60/)).toBeVisible();
});

test('round-trips a stack through its share code', async ({ page, context }) => {
  await loadTcpPreset(page);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share stack' });
  const code = (await dialog.locator('.select-all').textContent())?.trim();
  expect(code).toMatch(/^[a-z]+(?:\.[a-z]+)+$/);

  const freshPage = await context.newPage();
  await freshPage.goto(`/#/builder?s=${code}`);
  await expect(freshPage.getByRole('button', { name: 'Reorder Ethernet II layer' })).toBeVisible();
  await expect(freshPage.getByRole('button', { name: 'Reorder IPv4 layer' })).toBeVisible();
  await expect(freshPage.getByRole('button', { name: 'Reorder TCP layer' })).toBeVisible();
});

test('exports a PCAP with the expected file header', async ({ page }) => {
  await loadTcpPreset(page);
  await page.getByRole('button', { name: 'Export PCAP' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export PCAP' }).getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect([...bytes.subarray(0, 4)]).toEqual([0xd4, 0xc3, 0xb2, 0xa1]);
});

test('exports a standalone packet diagram as SVG', async ({ page }) => {
  await loadTcpPreset(page);
  await page.getByRole('button', { name: 'Diagram', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export diagram' }).getByRole('button', { name: 'Download SVG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('packet-stack.svg');
  const contents = await readFile((await download.path())!, 'utf8');
  expect(contents).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(contents).toContain('Ethernet II');
  expect(contents).not.toContain('class=');
});

test('persists collapsed builder panes across reloads', async ({ page }) => {
  await loadTcpPreset(page);
  await page.getByRole('button', { name: 'Collapse packet diagrams pane' }).click();
  await expect(page.getByRole('button', { name: 'Expand packet diagrams pane' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand packet diagrams pane' })).toBeVisible();
});
