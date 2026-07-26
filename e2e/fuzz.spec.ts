import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The lab fuzzes whatever the Stack Builder currently holds, and everything is
 * seeded — so fixing the seed makes the whole page deterministic and the
 * assertions can be specific rather than "something changed".
 */
async function openLab(page: Page, seed = 4242) {
  await page.goto('/#/lab/fuzzing');
  await expect(page.getByRole('heading', { name: 'Packet Lab' })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Seed' }).fill(String(seed));
  await expect(page.getByRole('region', { name: 'Mutation result' })).toBeVisible();
}

const mutations = (page: Page) =>
  page.getByRole('region', { name: 'Mutation result' }).getByRole('listitem');

test('mutates the packet and marks the changed bytes', async ({ page }) => {
  await openLab(page);

  // The default stack is Ethernet › IPv4 › TCP.
  await expect(page.getByText(/\d+-byte packet/)).toBeVisible();
  await expect(page.getByText(/ethernet › ipv4 › tcp/)).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Mutations' }).fill('3');
  await expect(mutations(page)).toHaveCount(3);
  await expect(mutations(page).first()).toContainText(/Flipped bit/);

  // Mutated bytes are marked in the hex dump, and say so rather than relying
  // on the outline alone.
  await expect(page.getByRole('button', { name: /Mutated/ }).first()).toBeVisible();
});

test('is reproducible from a seed and changes with it', async ({ page }) => {
  await openLab(page, 4242);
  const first = await mutations(page).first().textContent();

  await page.getByRole('spinbutton', { name: 'Seed' }).fill('99');
  await expect(mutations(page).first()).not.toHaveText(first!);

  await page.getByRole('spinbutton', { name: 'Seed' }).fill('4242');
  await expect(mutations(page).first()).toHaveText(first!);
});

test('explains what a receiver would make of the packet', async ({ page }) => {
  await openLab(page);
  const diagnosis = page.getByRole('region', { name: 'Diagnosis' });

  // Three stages are always reported: dissection, validation, lint.
  await expect(diagnosis.getByRole('listitem')).toHaveCount(3);
  await expect(diagnosis).toContainText(/Ethernet II/);

  // Overstating a length stops the dissector partway, and the panel says so.
  await page.getByRole('combobox', { name: 'Strategy' }).selectOption({ label: 'Length overflow' });
  await expect(diagnosis).toContainText(/stopped after \d of 3 layers/);
});

test('confines mutations to the targeted layer', async ({ page }) => {
  await openLab(page);
  await page.getByRole('checkbox', { name: 'TCP' }).check();
  await page.getByRole('spinbutton', { name: 'Mutations' }).fill('4');

  // Ethernet occupies bytes 0-13, so nothing there should be marked.
  const marked = await page
    .getByRole('button', { name: /Mutated/ })
    .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-byte-offset'))));

  expect(marked.length).toBeGreaterThan(0);
  for (const offset of marked) expect(offset).toBeGreaterThanOrEqual(34);
});

test('hides length-changing strategies until they are enabled', async ({ page }) => {
  await openLab(page);
  const strategy = page.getByRole('combobox', { name: 'Strategy' });

  await expect(strategy.getByRole('option', { name: 'Truncate' })).toHaveCount(0);

  await page.getByRole('checkbox', { name: /Allow length-changing/ }).check();
  await expect(strategy.getByRole('option', { name: 'Truncate' })).toHaveCount(1);

  // A truncated packet has no stack, so the lab falls back to raw bytes and
  // says why rather than pretending it can still describe the fields.
  await strategy.selectOption({ label: 'Truncate' });
  await expect(
    page.getByText('This packet no longer maps onto a stack', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export PCAP' })).toBeDisabled();
});

test('exports a fuzzed packet', async ({ page }) => {
  await openLab(page);
  await page.getByRole('button', { name: 'Export PCAP' }).click();

  const dialog = page.getByRole('dialog', { name: 'Export PCAP' });
  await expect(dialog).toBeVisible();
  // The builder-only "wrap in Ethernet" affordance is not offered here, since
  // it would edit a different stack than the one being exported.
  await expect(dialog.getByRole('button', { name: 'Wrap stack in Ethernet' })).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('proto-viz.pcap');
});

test('runs a campaign and reopens one of its seeds', async ({ page }) => {
  await openLab(page);
  await page.getByRole('tab', { name: 'Campaign' }).click();
  await page.getByRole('spinbutton', { name: 'Runs' }).fill('40');
  await page.getByRole('button', { name: 'Run campaign' }).click();

  await expect(page.getByRole('status')).toContainText('40 runs');
  const rows = page.getByRole('table').locator('tbody tr');
  await expect(rows.first()).toBeVisible();

  // Opening a seed returns to the single view with that seed loaded.
  const seedButton = page.getByRole('button', { name: /^Open seed / }).first();
  const seed = (await seedButton.textContent())!.trim();
  await seedButton.click();
  await expect(page.getByRole('spinbutton', { name: 'Seed' })).toHaveValue(seed);
  await expect(page.getByRole('region', { name: 'Mutation result' })).toBeVisible();
});

test('sends a fuzzed packet to the Stack Builder', async ({ page }) => {
  await openLab(page);
  await page.getByRole('button', { name: 'Open in Stack Builder' }).click();

  await expect(page.getByRole('heading', { name: 'Stack Builder' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Field editor' })).toBeVisible();
});

for (const theme of ['dark', 'light'] as const) {
  test(`has no automated WCAG A/AA violations in ${theme} mode`, async ({ page }) => {
    await page.addInitScript((selected) => {
      localStorage.setItem('pv-theme', selected);
    }, theme);
    await openLab(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
      // Bit-proportional diagram controls have equivalent full-size controls;
      // this documented WCAG 2.5.8 exception is explained in README.md.
      .disableRules(['target-size'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}
