import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const MTU = '28';

async function openFragmentationLab(page: Page) {
  await page.goto('/#/builder');
  await expect(page.getByRole('heading', { name: 'Stack Builder' })).toBeVisible();
  await page.getByRole('link', { name: 'Packet Lab', exact: true }).click();
  await expect(page).toHaveURL(/#\/lab$/);
  await expect(page.getByRole('heading', { name: 'Packet Lab' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Fragmentation' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('spinbutton', { name: 'Maximum transmission unit in bytes' }).fill(MTU);
  await expect(page.getByRole('region', { name: 'Fragment arrival timeline' })).toBeVisible();
}

function timeline(page: Page): Locator {
  return page.getByRole('region', { name: 'Fragment arrival timeline' });
}

async function selectLastArrival(page: Page) {
  await timeline(page).getByRole('listitem').last().getByRole('button').click();
}

async function chooseMode(page: Page, name: string) {
  await page.getByRole('radio', { name: new RegExp(`^${name}`) }).check();
  await expect(timeline(page).getByRole('status')).toContainText('Arrival 1 of');
}

test('fragments the current Builder packet and explains every reassembly outcome', async ({
  page,
}) => {
  await openFragmentationLab(page);
  const arrivals = timeline(page).getByRole('listitem');

  await expect(arrivals).toHaveCount(3);
  await expect(arrivals.nth(0).getByRole('button')).toHaveAccessibleName(
    /Arrival 1, original fragment 1, bytes 0 through 7, incomplete/,
  );
  await expect(arrivals.nth(1)).toContainText('bytes 8–15');
  await expect(arrivals.nth(1)).toContainText('offset 1 units · 8 B · MF=1');

  await page.getByRole('button', { name: 'Next fragment' }).click();
  await expect(timeline(page).getByRole('status')).toHaveText('Arrival 2 of 3 · incomplete');
  await expect(arrivals.nth(1).getByRole('button')).toHaveAttribute('aria-current', 'step');
  const fragmentOffset = page
    .getByRole('region', { name: 'Fragment fields' })
    .getByRole('button', { name: 'Highlight Fragment Offset in the packet views' })
    .locator('..');
  await expect(fragmentOffset).toContainText('1');
  await expect(page.getByRole('region', { name: 'Packet diagrams' })).toContainText('8 bytes');
  await expect(page.getByRole('region', { name: 'Hex dump' }).locator('[data-byte-offset]')).toHaveCount(42);

  await arrivals.nth(1).getByRole('button').focus();
  await page.keyboard.press('ArrowRight');
  await expect(timeline(page).getByRole('status')).toHaveText('Arrival 3 of 3 · complete');
  await expect(fragmentOffset).toContainText('2');
  await expect(page.getByText('Final result: complete; reassembled bytes exactly match the original.')).toBeVisible();
  await arrivals.nth(2).getByRole('button').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(timeline(page).getByRole('status')).toHaveText('Arrival 2 of 3 · incomplete');
  await expect(fragmentOffset).toContainText('1');
  await page.keyboard.press('ArrowRight');

  await chooseMode(page, 'Missing');
  await selectLastArrival(page);
  await expect(page.getByText('Fragment at offset 8 was removed.')).toBeVisible();
  await expect(page.getByText('Progressive diagnosis: Bytes 8-15 have not arrived.')).toBeVisible();
  await expect(page.getByText('Final result: incomplete; the original byte stream cannot yet be recovered.')).toBeVisible();

  await chooseMode(page, 'Duplicate');
  await selectLastArrival(page);
  await expect(arrivals).toHaveCount(4);
  await expect(page.getByText('Fragment at offset 8 was duplicated.')).toBeVisible();
  await expect(page.getByText('Progressive diagnosis: An exact duplicate at offset 8 is ignored.')).toBeVisible();
  await expect(page.getByText('Final result: complete; reassembled bytes exactly match the original.')).toBeVisible();

  await chooseMode(page, 'Overlap');
  await selectLastArrival(page);
  await expect(page.getByText('Fragment offset 8 was moved to 0, creating an overlap.')).toBeVisible();
  await expect(page.getByText(/Progressive diagnosis: Fragment at offset 0 overlaps another fragment/)).toBeVisible();
  await expect(page.getByText('Final result: ambiguous; overlapping bytes prevent one safe answer.')).toBeVisible();

  await chooseMode(page, 'Out of order');
  await expect(arrivals.nth(0)).toContainText('bytes 8–15');
  await selectLastArrival(page);
  await expect(page.getByText('The first two fragments were delivered out of order.')).toBeVisible();
  await expect(page.getByText('Progressive diagnosis: Fragment at offset 0 arrived out of order.')).toBeVisible();
  await expect(page.getByText('Final result: complete; reassembled bytes exactly match the original.')).toBeVisible();

  await chooseMode(page, 'Normal');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PCAP' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('fragmentation-normal-ipv4.pcap');
});

test('Fragmentation Lab has no automated WCAG A/AA violations', async ({ page }) => {
  await openFragmentationLab(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    .disableRules(['target-size'])
    .analyze();

  expect(results.violations).toEqual([]);
});

test.describe('mobile Fragmentation Lab', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('keeps controls and the scrollable timeline usable', async ({ page }) => {
    await openFragmentationLab(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const mtu = page.getByRole('spinbutton', { name: 'Maximum transmission unit in bytes' });
    const next = page.getByRole('button', { name: 'Next fragment' });
    for (const control of [mtu, next]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    }

    const arrivalList = timeline(page).getByRole('list');
    await expect
      .poll(() => arrivalList.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true);
    await next.click();
    await expect(timeline(page).getByRole('status')).toHaveText('Arrival 2 of 3 · incomplete');
  });
});
