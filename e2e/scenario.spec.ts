import { expect, test } from '@playwright/test';

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
