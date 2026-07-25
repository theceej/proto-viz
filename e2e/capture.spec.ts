import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/** The sample capture: a TCP handshake and a DNS exchange (5 packets). */
const FIXTURE = fileURLToPath(new URL('../fixtures/capture-handshake.pcap', import.meta.url));

/** Open the capture viewer with the sample file already loaded. */
async function openCapture(page: Page) {
  await page.goto('/#/capture');
  await expect(page.getByRole('heading', { name: 'Capture Viewer' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(FIXTURE);
  await expect(page.getByText('capture-handshake.pcap')).toBeVisible();
}

/** The "N of M packets" readout, scoped so other live regions can't match. */
const matchCount = (page: Page) =>
  page.getByRole('region', { name: 'Capture filters' }).getByRole('status');

test('opens a pcap file and inspects a packet in the synchronized panes', async ({ page }) => {
  await openCapture(page);

  // File-level facts come from the header, not a guess.
  await expect(page.getByText(/5 packets · LINKTYPE_ETHERNET \(1\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Packets (5)' })).toBeVisible();

  const list = page.getByRole('grid');
  await expect(list.getByRole('row')).toHaveCount(6); // header + 5 packets

  // The first packet is selected on load and drives the inspection panes.
  const fields = page.getByRole('region', { name: 'Field editor' });
  await expect(fields.getByText('TCP', { exact: true })).toBeVisible();

  // Selecting the DNS query swaps every pane over to it.
  await list.getByRole('row').filter({ hasText: 'DNS' }).first().click();
  await expect(fields.getByText('DNS', { exact: true })).toBeVisible();
  await expect(fields.getByText('Question Name')).toBeVisible();
});

test('sorts the packet list by a column', async ({ page }) => {
  await openCapture(page);
  const numbers = page.getByRole('grid').locator('tbody tr td:first-child');

  await expect(numbers).toHaveText(['1', '2', '3', '4', '5']);

  await page.getByRole('button', { name: 'Length', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Length' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  // The three 54-byte TCP frames sort ahead of the two larger DNS packets.
  await expect(numbers).toHaveText(['1', '2', '3', '4', '5']);

  await page.getByRole('button', { name: 'Length', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Length' })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await expect(numbers).toHaveText(['5', '4', '1', '2', '3']);
});

test('filters the capture by protocol, port, and free text', async ({ page }) => {
  await openCapture(page);
  const rows = page.getByRole('grid').locator('tbody tr');

  await expect(matchCount(page)).toHaveText('5 of 5 packets');

  await page.getByRole('combobox', { name: 'Protocol' }).selectOption({ label: 'DNS (2)' });
  await expect(matchCount(page)).toHaveText('2 of 5 packets');
  await expect(rows).toHaveCount(2);

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(matchCount(page)).toHaveText('5 of 5 packets');

  await page.getByRole('spinbutton', { name: 'Port' }).fill('80');
  await expect(matchCount(page)).toHaveText('3 of 5 packets');

  await page.getByRole('button', { name: 'Clear filters' }).click();
  // Free text reaches decoded field values, not just the summary line.
  await page.getByRole('searchbox').fill('example.com');
  await expect(matchCount(page)).toHaveText('2 of 5 packets');

  await page.getByRole('searchbox').fill('no-such-traffic');
  await expect(page.getByText('No packets match the current filters.')).toBeVisible();
});

test('groups packets into flows and narrows the list to one', async ({ page }) => {
  await openCapture(page);

  await page.getByRole('button', { name: 'Flows (2)' }).click();
  const flows = page.getByRole('table', { name: /Bidirectional flows/ });
  await expect(flows.locator('tbody tr')).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: '192.0.2.10:49152 ↔ 198.51.100.20:80' }),
  ).toBeVisible();

  // Selecting a flow filters the packet list to that conversation.
  await page.getByRole('button', { name: '192.0.2.10:53000 ↔ 198.51.100.53:53' }).click();
  await expect(page.getByRole('button', { name: 'Packets (2)' })).toBeVisible();
  await expect(page.getByRole('grid').locator('tbody tr')).toHaveCount(2);

  await page.getByRole('button', { name: 'Showing one flow' }).click();
  await expect(page.getByRole('button', { name: 'Packets (5)' })).toBeVisible();
});

test('sends two capture packets to Packet Comparison', async ({ page }) => {
  await openCapture(page);
  const list = page.getByRole('grid');

  await list.getByRole('row').nth(1).click();
  await page.getByRole('button', { name: 'Add to compare' }).click();
  await list.getByRole('row').filter({ hasText: 'DNS' }).first().click();
  await page.getByRole('button', { name: 'Add to compare' }).click();

  await page.getByRole('link', { name: 'Packet Comparison', exact: true }).click();
  const selection = page.getByRole('region', { name: 'Packets selected for comparison' });
  await expect(selection.getByText(/capture-handshake\.pcap · #1/)).toBeVisible();
  await expect(selection.getByText(/capture-handshake\.pcap · #4/)).toBeVisible();

  // The capture survives the round trip, so comparison is not a dead end.
  await page.getByRole('link', { name: 'Capture Viewer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Packets (5)' })).toBeVisible();
});

test('navigates packets with the arrow keys', async ({ page }) => {
  await openCapture(page);
  const rows = page.getByRole('grid').locator('tbody tr');

  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(rows.nth(4)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
});

test('keeps a wide packet list inside its own scroller on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openCapture(page);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('rejects a file that is not a classic pcap capture', async ({ page }) => {
  await page.goto('/#/capture');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'notes.pcap',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('this is not a capture file at all, honest'),
  });

  await expect(page.getByRole('alert')).toContainText('Not a classic pcap file');
  await expect(page.getByText('Drop a .pcap here, or click to browse')).toBeVisible();
});

test('explains that pcapng needs converting first', async ({ page }) => {
  await page.goto('/#/capture');
  const sectionHeader = Buffer.alloc(32);
  sectionHeader.writeUInt32BE(0x0a0d0d0a, 0);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'capture.pcapng',
    mimeType: 'application/octet-stream',
    buffer: sectionHeader,
  });

  await expect(page.getByRole('alert')).toContainText('pcapng');
  await expect(page.getByRole('alert')).toContainText('editcap');
});

for (const theme of ['dark', 'light'] as const) {
  test(`a loaded capture has no automated WCAG A/AA violations in ${theme} mode`, async ({
    page,
  }) => {
    await page.addInitScript((selected) => {
      localStorage.setItem('pv-theme', selected);
    }, theme);
    await openCapture(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
      // Bit-proportional diagram controls have equivalent full-size controls;
      // this documented WCAG 2.5.8 exception is explained in README.md.
      .disableRules(['target-size'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}
