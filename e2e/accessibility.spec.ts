import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const routes = ['/builder', '/library', '/import', '/help'];
const themes = ['dark', 'light'] as const;

async function expectNoWcagViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    // Bit-proportional diagram controls have equivalent full-size controls;
    // this documented WCAG 2.5.8 exception is explained in README.md.
    .disableRules(['target-size'])
    .analyze();

  expect(results.violations).toEqual([]);
}

for (const route of routes) {
  for (const theme of themes) {
    test(`${route} has no automated WCAG A/AA violations in ${theme} mode`, async ({ page }) => {
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem('pv-theme', selectedTheme);
      }, theme);
      await page.goto(`/#${route}`);
      await expect(page.locator('main')).toBeVisible();

      await expectNoWcagViolations(page);
    });
  }
}

for (const theme of themes) {
  test(`builder dialogs have no automated WCAG A/AA violations in ${theme} mode`, async ({
    page,
  }) => {
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem('pv-theme', selectedTheme);
    }, theme);
    await page.goto('/#/builder');

    for (const name of ['Share', 'Decode', 'Diagram', 'Export PCAP']) {
      await page.getByRole('button', { name, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expectNoWcagViolations(page);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  });
}
