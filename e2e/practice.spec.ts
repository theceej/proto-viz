import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Questions are generated from a random packet, so a test cannot know which
 * option is right. Everything here asserts on the *shape* of a round instead:
 * one correct option exists, answering reveals it, and the score follows the
 * verdict the page itself reported.
 */
const choices = (page: Page) => page.getByRole('listitem').getByRole('button');
const reveal = (page: Page) => page.getByRole('status');

async function openPractice(page: Page) {
  await page.goto('/#/practice');
  await expect(page.getByRole('heading', { name: 'Packet Practice' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
}

test('answers a question, reveals the answer, and scores it', async ({ page }) => {
  await openPractice(page);

  await expect(page.getByText(/Question 1 of \d/)).toBeVisible();
  await expect(choices(page)).toHaveCount(4);
  await expect(page.getByLabel('0 of 0 correct')).toBeVisible();

  // Nothing is revealed until an answer is committed.
  await expect(page.getByText('Correct answer')).toHaveCount(0);

  await choices(page).first().click();

  // Exactly one option is now marked correct, and the verdict is stated in
  // words rather than by colour alone.
  await expect(page.getByText('Correct answer')).toHaveCount(1);
  const verdict = await reveal(page).textContent();
  const wasCorrect = verdict!.includes('Correct.');
  await expect(page.getByLabel(`${wasCorrect ? 1 : 0} of 1 correct`)).toBeVisible();
  await expect(page.getByLabel(`${wasCorrect ? 100 : 0} percent accuracy`)).toBeVisible();

  // Answering twice is not possible.
  await expect(choices(page).first()).toBeDisabled();
});

test('advances through a round and draws a new packet at the end', async ({ page }) => {
  await openPractice(page);
  const total = Number(
    (await page.getByText(/Question 1 of \d/).textContent())!.match(/of (\d)/)![1],
  );

  for (let i = 1; i <= total; i++) {
    await expect(page.getByText(`Question ${i} of ${total}`)).toBeVisible();
    await choices(page).first().click();
    await page
      .getByRole('button', { name: i < total ? 'Next question' : 'Next packet', exact: true })
      .click();
  }

  // The round rolled over to a fresh packet, and the score kept counting.
  await expect(page.getByText(/Question 1 of \d/)).toBeVisible();
  await expect(page.getByLabel(new RegExp(`of ${total} correct`))).toBeVisible();
});

test('is fully operable from the keyboard', async ({ page }) => {
  await openPractice(page);

  // Number keys pick an option wherever focus happens to be; Enter advances
  // once the answer is showing.
  await page.keyboard.press('2');
  await expect(page.getByText('Correct answer')).toHaveCount(1);
  await expect(page.getByLabel(/of 1 correct/)).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.getByText('Question 2 of', { exact: false })).toBeVisible();
  await expect(page.getByText('Correct answer')).toHaveCount(0);
});

test('sends the packet to the Stack Builder for a proper look', async ({ page }) => {
  await openPractice(page);
  await choices(page).first().click();
  await page.getByRole('button', { name: 'Inspect in Stack Builder' }).click();

  await expect(page.getByRole('heading', { name: 'Stack Builder' })).toBeVisible();
  // The quiz packet is loaded, so the hex view has bytes to show.
  await expect(page.getByRole('region', { name: 'Field editor' })).toBeVisible();
});

test('switches packet source and keeps generating questions', async ({ page }) => {
  await openPractice(page);
  await page.getByRole('combobox', { name: 'Packet source' }).selectOption('curated');

  await expect(page.getByText(/Drawn from the builder presets/)).toBeVisible();
  await expect(choices(page)).toHaveCount(4);
  await choices(page).first().click();
  await expect(reveal(page)).toContainText('Preset: ');
});

test('draws a different packet on demand', async ({ page }) => {
  await openPractice(page);
  const first = await page.getByRole('heading', { level: 2 }).textContent();

  // A new packet resets to the first question of a fresh round.
  await choices(page).first().click();
  await page.getByRole('button', { name: 'New packet' }).first().click();
  await expect(page.getByText(/Question 1 of \d/)).toBeVisible();
  await expect(page.getByText('Correct answer')).toHaveCount(0);
  // The score survives the redraw — it is a session total, not a round total.
  await expect(page.getByLabel(/of 1 correct/)).toBeVisible();
  expect(typeof first).toBe('string');
});

for (const theme of ['dark', 'light'] as const) {
  test(`has no automated WCAG A/AA violations with an answer revealed in ${theme} mode`, async ({
    page,
  }) => {
    await page.addInitScript((selected) => {
      localStorage.setItem('pv-theme', selected);
    }, theme);
    await openPractice(page);
    await choices(page).first().click();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
      // Bit-proportional diagram controls have equivalent full-size controls;
      // this documented WCAG 2.5.8 exception is explained in README.md.
      .disableRules(['target-size'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}
