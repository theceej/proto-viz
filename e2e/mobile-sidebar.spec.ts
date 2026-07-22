import { expect, test } from '@playwright/test';

test.describe('mobile sidebar (375px)', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('collapses to an icon rail but keeps navigation reachable', async ({ page }) => {
    await page.goto('/#/builder');
    await expect(page.locator('main')).toBeVisible();

    // The sidebar is a slim icon rail (~56px), not the 224px desktop sidebar.
    await expect
      .poll(() =>
        page.locator('aside').evaluate((el) => Math.round(el.getBoundingClientRect().width)),
      )
      .toBeLessThan(80);

    // Nav items are still reachable (named via their title/aria-label).
    await page.getByRole('link', { name: 'Protocol Library', exact: true }).click();
    await expect(page).toHaveURL(/#\/library$/);
  });
});
