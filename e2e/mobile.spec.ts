import { expect, test } from '@playwright/test';

const routes = ['/builder', '/scenario', '/library', '/import', '/help', '/compare'];

test.describe('narrow viewport (375px)', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  for (const route of routes) {
    test(`no horizontal page scroll on ${route}`, async ({ page }) => {
      await page.goto(`/#${route}`);
      await expect(page.locator('main')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('builder dialogs fit within the viewport', async ({ page }) => {
    await page.goto('/#/builder');
    for (const name of ['Export PCAP', 'Decode', 'Share'] as const) {
      await page.getByRole('button', { name, exact: true }).click();
      const box = await page.getByRole('dialog').boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.x, name).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, name).toBeLessThanOrEqual(375);
      await page.keyboard.press('Escape');
    }
  });

  test('library protocol details take over the screen, hiding the list', async ({ page }) => {
    await page.goto('/#/library/ipv4');
    await expect(page.getByRole('heading', { name: 'IPv4', level: 2 })).toBeVisible();
    // The list header is hidden while the detail panel is open.
    await expect(page.getByRole('heading', { name: 'Protocol Library' })).toBeHidden();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // Closing the detail brings the list back.
    await page.getByRole('button', { name: 'Close protocol details' }).click();
    await expect(page.getByRole('heading', { name: 'Protocol Library' })).toBeVisible();
  });
});
