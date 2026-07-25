import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('composes, saves, previews, and exports a custom packet exchange', async ({
  page,
}) => {
  await page.goto('/#/scenario');
  await page.getByRole('button', { name: 'Compose' }).click();

  const composer = page.getByRole('region', { name: 'Scenario composer' });
  await expect(composer).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .disableRules(['target-size'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await composer.getByRole('textbox', { name: 'Scenario name' }).fill('Troubleshooting lesson');
  await composer.getByRole('textbox', { name: 'Scenario description' }).fill(
    'A deliberately paced two-packet exchange.',
  );
  await composer.getByRole('textbox', { name: 'Endpoint A' }).fill('client');
  await composer.getByRole('textbox', { name: 'Endpoint B' }).fill('server');

  const steps = composer.getByRole('listitem');
  await steps.nth(0).getByRole('textbox', { name: 'Step 1 label' }).fill('request');
  await steps
    .nth(0)
    .getByRole('spinbutton', { name: 'Step 1 time in milliseconds' })
    .fill('25');

  await composer.getByRole('button', { name: 'Add current packet' }).click();
  await expect(steps).toHaveCount(2);
  await steps.nth(1).getByRole('textbox', { name: 'Step 2 label' }).fill('response');
  await steps
    .nth(1)
    .getByRole('combobox', { name: 'From' })
    .selectOption('1');
  await steps.nth(1).getByRole('combobox', { name: 'To' }).selectOption('0');
  await steps
    .nth(1)
    .getByRole('spinbutton', { name: 'Step 2 time in milliseconds' })
    .fill('80');

  await steps.nth(1).getByRole('button', { name: 'Duplicate step 2' }).click();
  await expect(steps).toHaveCount(3);
  await steps.nth(2).getByRole('button', { name: 'Move step 3 earlier' }).click();
  await steps.nth(2).getByRole('button', { name: 'Delete step 3' }).click();
  await expect(steps).toHaveCount(2);

  await composer.getByRole('button', { name: 'Preview step 2: response copy' }).click();
  const timeline = page.getByRole('region', { name: 'Packet timeline' });
  await expect(timeline.getByRole('status')).toHaveText('Step 2 of 2');
  await expect(timeline.getByText('t+90 ms')).toBeVisible();
  await expect(timeline.getByText('client')).toBeVisible();
  await expect(timeline.getByText('server')).toBeVisible();

  await composer.getByRole('button', { name: 'Save locally' }).click();
  await expect(composer.getByRole('status')).toHaveText('Saved');

  await composer.getByRole('button', { name: 'Edit fields in Builder' }).click();
  await expect(page).toHaveURL(/#\/builder$/);
  await page.getByRole('textbox', { name: 'TTL', exact: true }).fill('63');
  await page.getByRole('link', { name: 'Scenario Timeline' }).click();
  await page
    .getByRole('combobox', { name: 'Scenario' })
    .selectOption({ label: 'Custom · Troubleshooting lesson' });
  await page.getByRole('button', { name: 'Compose' }).click();
  const reopenedComposer = page.getByRole('region', { name: 'Scenario composer' });
  await reopenedComposer.getByRole('button', { name: 'Preview step 2: response copy' }).click();
  await reopenedComposer
    .getByRole('button', { name: 'Update from current Builder packet' })
    .click();

  await page.reload();
  await page
    .getByRole('combobox', { name: 'Scenario' })
    .selectOption({ label: 'Custom · Troubleshooting lesson' });
  await expect(page.getByText('A deliberately paced two-packet exchange.')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PCAP' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Troubleshooting-lesson.pcap');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).subarray(0, 4).toString('hex')).toBe('d4c3b2a1');
});
