import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const routes = ['/builder', '/library', '/import', '/help'];
const themes = ['dark', 'light'] as const;

for (const route of routes) {
  for (const theme of themes) {
    test(`${route} has no automated WCAG A/AA violations in ${theme} mode`, async ({ page }) => {
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem('pv-theme', selectedTheme);
      }, theme);
      await page.goto(`/#${route}`);
      await expect(page.locator('main')).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        // Bit-proportional diagram controls have equivalent full-size controls;
        // this documented WCAG 2.5.8 exception is explained in README.md.
        .disableRules(['target-size'])
        .analyze();

      expect(results.violations).toEqual([]);
    });
  }
}
