import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('adds the current builder packet to the comparison page', async ({ page }) => {
  await page.goto('/#/builder');
  await page.getByRole('button', { name: /Add to compare/ }).click();
  await page.getByRole('link', { name: 'Packet Comparison' }).click();

  const selections = page.getByRole('region', { name: 'Packets selected for comparison' });
  await expect(selections).toContainText('Stack Builder packet');
  await expect(page.getByText('Add one more packet to start comparing.')).toBeVisible();
});

test('offers an app-wide tour from Help and persists inspection detail', async ({ page }) => {
  await page.goto('/#/builder');
  await page.getByRole('radio', { name: 'Deep' }).click();
  await expect(page.getByRole('radio', { name: 'Deep' })).toBeChecked();

  await page.reload();
  await expect(page.getByRole('radio', { name: 'Deep' })).toBeChecked();
  await page.goto('/#/help');
  await page.getByRole('button', { name: 'Start guided tour' }).click();
  await expect(page.getByRole('region', { name: 'Build a protocol stack' })).toBeVisible();
  await expect(page).toHaveURL(/#\/builder$/);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('region', { name: 'Browse the protocol library' })).toBeVisible();
  await expect(page).toHaveURL(/#\/library$/);
  await page.getByRole('button', { name: 'Skip guided tour' }).click();
});

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
  await expect(page.locator('[data-byte-offset="6"]')).toHaveText('aa');
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
  await expect(page.locator('[data-byte-offset="46"]')).toHaveText('60');
});

test('adds a structured IPv4 Router Alert option and updates IHL', async ({ page }) => {
  await loadTcpPreset(page);
  await page.getByRole('checkbox', { name: 'Router Alert' }).check();
  await expect(page.locator('[data-byte-offset="14"]')).toHaveText('46');
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

test('round-trips field edits through the exact-packet share link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await loadTcpPreset(page);
  await page.getByRole('textbox', { name: 'Source MAC', exact: true }).fill('aa:bb:cc:dd:ee:ff');

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share stack' });
  await dialog.getByRole('button', { name: 'Copy exact-packet link' }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('&e=');

  const freshPage = await context.newPage();
  await freshPage.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  // The edited Source MAC survived the link (byte 6 = 0xaa).
  await expect(freshPage.locator('[data-byte-offset="6"]')).toHaveText('aa');
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

test('copies the packet diagram to the clipboard as a PNG', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await loadTcpPreset(page);
  await page.getByRole('button', { name: 'Diagram', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export diagram' });
  const bounds = await dialog.boundingBox();
  expect(bounds?.width).toBeGreaterThan(800);
  expect(bounds?.height).toBeGreaterThan(600);
  await expect(dialog).toHaveCSS('resize', 'both');

  await dialog.getByRole('button', { name: 'Copy image' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Image copied');
  const types = await page.evaluate(async () =>
    (await navigator.clipboard.read()).flatMap((item) => item.types),
  );
  expect(types).toContain('image/png');
});

test('persists collapsed builder panes across reloads', async ({ page }) => {
  await loadTcpPreset(page);
  await page.getByRole('button', { name: 'Collapse packet diagrams pane' }).click();
  await expect(page.getByRole('button', { name: 'Expand packet diagrams pane' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand packet diagrams pane' })).toBeVisible();
});

test('resizes builder panes with the keyboard and persists the split', async ({ page }) => {
  await loadTcpPreset(page);
  const fieldPane = page.getByRole('region', { name: 'Field editor' });
  const handle = page.getByRole('separator', {
    name: 'Resize field editor and packet diagrams',
  });
  const before = await fieldPane.evaluate((element) => element.getBoundingClientRect().width);

  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => fieldPane.evaluate((element) => element.getBoundingClientRect().width)).toBe(
    Math.round(before) + 24,
  );

  await page.reload();
  await expect(fieldPane).toHaveCSS('width', `${Math.round(before) + 24}px`);
  await handle.focus();
  await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute('aria-valuetext', 'Responsive default');
});

test('keeps the outer panes resizable when packet diagrams are collapsed', async ({
  page,
}) => {
  await loadTcpPreset(page);
  await page.getByRole('button', { name: 'Collapse packet diagrams pane' }).click();

  const hexPane = page.getByRole('region', { name: 'Hex dump' });
  const handle = page.getByRole('separator', {
    name: 'Resize field editor and hex dump',
  });
  const before = await hexPane.evaluate((element) => element.getBoundingClientRect().width);

  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => hexPane.evaluate((element) => element.getBoundingClientRect().width)).toBe(
    Math.round(before) + 24,
  );
});

test('runs a malformed-packet experiment and undoes it', async ({ page }) => {
  await loadTcpPreset(page);

  // Apply the "corrupt the IPv4 checksum" experiment.
  await page.getByRole('button', { name: 'Break this packet' }).click();
  await page.getByRole('menuitem', { name: /Corrupt the IPv4 header checksum/ }).click();

  // The deliberate diagnostic and the explanatory banner both appear.
  await expect(page.getByText(/correct checksum is/i)).toBeVisible();
  await expect(page.getByText(/checksum-mismatch warning/i)).toBeVisible();

  // Undo restores the valid packet.
  await page.getByRole('button', { name: 'Undo experiment' }).click();
  await expect(page.getByText(/correct checksum is/i)).toHaveCount(0);
  await expect(page.getByText(/checksum-mismatch warning/i)).toHaveCount(0);
});

test('moves the byte summary into the stack strip', async ({ page }) => {
  await loadTcpPreset(page);
  // Ethernet(14) + IPv4(20) + TCP(20) = 54 bytes, 54 header bytes.
  await expect(page.getByText(/54 bytes · 54 headers/)).toBeVisible();
});
