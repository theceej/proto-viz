import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The shell and, more to the point, the hand-off between the two tabs. Each
 * lab is covered in depth by its own spec; this covers what only exists
 * because they were joined — passing a packet from one to the other.
 */
const sourceChip = (page: Page) => page.getByText('Working on', { exact: false });

async function openLab(page: Page) {
  await page.goto('/#/lab');
  await expect(page.getByRole('heading', { name: 'Packet Lab' })).toBeVisible();
}

test('opens on fragmentation and switches tabs through the URL', async ({ page }) => {
  await openLab(page);
  await expect(page.getByRole('tab', { name: 'Fragmentation' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('tab', { name: 'Fuzzing' }).click();
  await expect(page).toHaveURL(/#\/lab\/fuzzing$/);
  await expect(page.getByRole('region', { name: 'Mutation result' })).toBeVisible();

  // The tab is in the URL, so back steps between tabs.
  await page.goBack();
  await expect(page).toHaveURL(/#\/lab$/);
  await expect(page.getByRole('tab', { name: 'Fragmentation' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('keeps the old lab links working', async ({ page }) => {
  await page.goto('/#/fragmentation');
  await expect(page).toHaveURL(/#\/lab\/fragmentation$/);
  await expect(page.getByRole('heading', { name: 'Packet Lab' })).toBeVisible();

  await page.goto('/#/fuzz');
  await expect(page).toHaveURL(/#\/lab\/fuzzing$/);
  await expect(page.getByRole('region', { name: 'Mutation result' })).toBeVisible();
});

test('hands a fragment to the fuzzer', async ({ page }) => {
  await openLab(page);
  // A small MTU guarantees several fragments to choose between.
  await page.getByRole('spinbutton', { name: 'Maximum transmission unit in bytes' }).fill('28');
  await expect(page.getByRole('region', { name: 'Fragment arrival timeline' })).toBeVisible();

  await expect(sourceChip(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Fuzz this fragment' }).click();

  // We land on the fuzzing tab, working on that fragment rather than the
  // Builder packet, and the banner says so.
  await expect(page).toHaveURL(/#\/lab\/fuzzing$/);
  await expect(sourceChip(page)).toContainText(/Fragment 1 of \d/);
  await expect(sourceChip(page)).toContainText('fragmentation tab');
  await expect(page.getByRole('region', { name: 'Mutation result' })).toBeVisible();
});

test('hands a fuzzed packet to fragmentation', async ({ page }) => {
  await page.goto('/#/lab/fuzzing');
  await expect(page.getByRole('region', { name: 'Mutation result' })).toBeVisible();
  await page.getByRole('button', { name: 'Fragment this packet' }).click();

  await expect(page).toHaveURL(/#\/lab\/fragmentation$/);
  await expect(sourceChip(page)).toContainText(/Fuzzed: seed \d+/);
  await expect(sourceChip(page)).toContainText('fuzzing tab');
  // Fragmentation is genuinely operating on the corrupted packet.
  await page.getByRole('spinbutton', { name: 'Maximum transmission unit in bytes' }).fill('28');
  await expect(page.getByRole('region', { name: 'Fragment arrival timeline' })).toBeVisible();
});

test('each tab keeps its own source, and either can be reset', async ({ page }) => {
  await openLab(page);
  await page.getByRole('spinbutton', { name: 'Maximum transmission unit in bytes' }).fill('28');
  await page.getByRole('button', { name: 'Fuzz this fragment' }).click();
  await expect(sourceChip(page)).toBeVisible();

  // Fragmentation itself was not disturbed by handing a fragment away.
  await page.getByRole('tab', { name: 'Fragmentation' }).click();
  await expect(sourceChip(page)).toHaveCount(0);

  // The fuzzer still holds the fragment until it is reset.
  await page.getByRole('tab', { name: 'Fuzzing' }).click();
  await expect(sourceChip(page)).toBeVisible();
  await page.getByRole('button', { name: 'Use the Builder packet' }).click();
  await expect(sourceChip(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Mutation result' })).toBeVisible();
});

test('offers one Packet Lab entry in the sidebar', async ({ page }) => {
  await openLab(page);
  await expect(page.getByRole('link', { name: 'Packet Lab', exact: true })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Fragmentation Lab' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Fuzzing Lab' })).toHaveCount(0);
});

/**
 * The hand-off banner only exists after a hand-off, so the shared route sweep
 * — which visits every page in its default state — can never see it. That is
 * the same blind spot that hid a contrast failure on this page until CI found
 * it, so the states a sweep cannot reach get their own checks.
 */
for (const theme of ['dark', 'light'] as const) {
  test(`the hand-off banner has no WCAG A/AA violations in ${theme} mode`, async ({ page }) => {
    await page.addInitScript((selected) => {
      localStorage.setItem('pv-theme', selected);
    }, theme);
    await openLab(page);
    await page.getByRole('spinbutton', { name: 'Maximum transmission unit in bytes' }).fill('28');
    await page.getByRole('button', { name: 'Fuzz this fragment' }).click();
    await expect(sourceChip(page)).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
      .disableRules(['target-size'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}
