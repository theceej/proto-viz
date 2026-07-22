import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('steps through a scenario timeline and updates the inspection panes', async ({ page }) => {
  await page.goto('/#/scenario');
  await expect(page.getByRole('heading', { name: 'Scenario Timeline' })).toBeVisible();

  // Pick a deterministic exchange.
  await page.getByRole('combobox', { name: 'Scenario' }).selectOption({
    label: 'TCP three-way handshake',
  });
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await expect(page.getByRole('button', { name: /Step 1: SYN,/ })).toHaveAttribute(
    'aria-current',
    'step',
  );

  // Next advances the step and moves the current marker.
  await page.getByRole('button', { name: 'Next packet' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await expect(page.getByRole('button', { name: /Step 2: SYN-ACK/ })).toHaveAttribute(
    'aria-current',
    'step',
  );

  // Selecting a step loads its packet; the field editor shows that layer.
  await page.getByRole('button', { name: /Step 3: ACK/ }).click();
  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  const fields = page.getByRole('region', { name: 'Field editor' });
  await expect(fields.getByText('TCP', { exact: true })).toBeVisible();

  // Next is disabled at the end; Previous steps back.
  await expect(page.getByRole('button', { name: 'Next packet' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous packet' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();

  // Play/Pause is operable.
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('collapses and resizes the scenario inspection panes', async ({ page }) => {
  await page.goto('/#/scenario');

  // Collapse the packet diagrams pane; state persists across a reload.
  await page.getByRole('button', { name: 'Collapse packet diagrams pane' }).click();
  await expect(page.getByRole('button', { name: 'Expand packet diagrams pane' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand packet diagrams pane' })).toBeVisible();

  // With diagrams collapsed the outer panes stay resizable via the divider.
  const hexPane = page.getByRole('region', { name: 'Hex dump' });
  const handle = page.getByRole('separator', { name: 'Resize field editor and hex dump' });
  const before = await hexPane.evaluate((el) => el.getBoundingClientRect().width);
  await handle.focus();
  await handle.press('ArrowLeft');
  await expect
    .poll(() => hexPane.evaluate((el) => el.getBoundingClientRect().width))
    .toBe(Math.round(before) + 24);
});

test('adds scenario packets to the dedicated comparison page', async ({ page }) => {
  await page.goto('/#/scenario');
  await page.getByRole('combobox', { name: 'Scenario' }).selectOption({
    label: 'TCP three-way handshake',
  });
  await page.getByRole('button', { name: /Add to compare/ }).click();
  await page.getByRole('button', { name: /Step 2: SYN-ACK/ }).click();
  await page.getByRole('button', { name: /Add to compare/ }).click();
  await page.getByRole('link', { name: 'Packet Comparison' }).click();

  await expect(page.getByRole('region', { name: 'Packet comparison' })).toBeVisible();
  const selections = page.getByRole('region', { name: 'Packets selected for comparison' });
  await expect(selections).toContainText('SYN');
  await expect(selections).toContainText('SYN-ACK');
  await expect(page.getByText(/\d+ editable/)).toBeVisible();
  await expect(page.getByText(/\d+ computed/)).toBeVisible();

  const computedChange = page.getByRole('button', { name: /Changed, computed/ }).first();
  await computedChange.focus();
  await computedChange.press('Enter');
  await expect(computedChange).toHaveAttribute('aria-pressed', 'true');
  expect(
    await page.locator('button[aria-label^="Byte "][aria-pressed="true"]').count(),
  ).toBeGreaterThan(0);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    .disableRules(['target-size'])
    .analyze();
  expect(results.violations).toEqual([]);
});
