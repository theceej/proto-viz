import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openAssignments(page: Page) {
  await page.goto('/#/practice');
  await page.getByRole('button', { name: 'Assignments', exact: true }).click();
  return page.getByRole('dialog', { name: 'Assignments', exact: true });
}

async function createFromBuilder(page: Page, title = 'Packet lesson') {
  const dialog = await openAssignments(page);
  await dialog.getByRole('button', { name: 'Create assignment', exact: true }).click();
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByRole('button', { name: '2. Packets' }).click();
  await dialog.getByRole('button', { name: 'Add current Builder packet' }).click();
  return dialog;
}

async function downloadedPackage(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download assignment', exact: true }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return { download, quiz: JSON.parse(Buffer.concat(chunks).toString()) };
}

test('edits candidate and manual questions, changes targets and order, and exports a student-ready package', async ({
  page,
}) => {
  const dialog = await createFromBuilder(page);
  await dialog.getByRole('button', { name: '3. Questions' }).click();
  await dialog
    .getByRole('textbox', { name: 'Prompt', exact: true })
    .fill('Edited candidate prompt');
  await dialog.getByLabel('Choice 1', { exact: true }).fill('Edited answer');
  await dialog
    .getByRole('textbox', { name: 'Explanation', exact: true })
    .fill('Read the highlighted TTL field.');
  await dialog
    .getByRole('combobox', { name: 'Correct answer', exact: true })
    .selectOption({ index: 0 });
  await dialog.getByRole('combobox', { name: 'Focus layer', exact: true }).selectOption('1');
  await dialog.getByRole('combobox', { name: 'Focus field', exact: true }).selectOption('ttl');
  await dialog.getByRole('button', { name: 'Add manual question' }).click();
  await dialog.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Manual packet question');
  await dialog.getByLabel('Choice 1', { exact: true }).fill('First answer');
  await dialog.getByLabel('Choice 2', { exact: true }).fill('Second answer');
  await dialog
    .getByRole('combobox', { name: 'Correct answer', exact: true })
    .selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Add answer choice' }).click();
  await dialog.getByLabel('Choice 3', { exact: true }).fill('Third answer');
  await dialog.getByRole('button', { name: 'Remove choice 3' }).click();
  await dialog.getByRole('button', { name: 'Move question earlier' }).click();
  await dialog.getByRole('button', { name: '4. Review' }).click();
  await expect(dialog.getByRole('button', { name: 'Download assignment' })).toBeEnabled();
  const { download, quiz } = await downloadedPackage(page);
  expect(download.suggestedFilename()).toBe('packet-lesson.protoviz-quiz');
  expect(quiz.packets[0].source.kind).toBe('builder');
  expect(quiz.questions[0]).toMatchObject({
    prompt: 'Edited candidate prompt',
    focus: { layerIndex: 1, fieldId: 'ttl' },
  });
  const manualIndex = quiz.questions.findIndex(
    (item: { prompt: string }) => item.prompt === 'Manual packet question',
  );
  expect(manualIndex).toBe(quiz.questions.length - 2);
  expect(quiz.questions[manualIndex].correctChoiceId).toBe(
    quiz.questions[manualIndex].choices[1].id,
  );
  await dialog.getByRole('button', { name: 'Back to assignments' }).click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'lesson.protoviz-quiz',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(quiz)),
  });
  await expect(dialog.getByRole('button', { name: 'Start assignment' })).toBeVisible();
});

test('resumes the exact authoring step and last question edit after reload', async ({ page }) => {
  let dialog = await createFromBuilder(page, 'Resumable lesson');
  await dialog.getByRole('button', { name: '3. Questions' }).click();
  await dialog.getByRole('button', { name: 'Add manual question' }).click();
  await dialog.getByRole('textbox', { name: 'Prompt', exact: true }).fill('A saved question');
  await expect(dialog.getByRole('status')).toHaveText('Draft saved');
  await dialog.getByRole('button', { name: '3. Questions' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Draft saved');
  await page.reload();
  await page.getByRole('button', { name: 'Assignments', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Assignments', exact: true });
  await dialog
    .getByRole('button', {
      name: 'Resume draft: Resumable lesson',
      exact: true,
    })
    .click();
  await expect(dialog.getByRole('heading', { name: 'Questions', exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue(
    'A saved question',
  );
});

test('keeps keyboard focus and practice shortcuts inside the assignment modal', async ({
  page,
}) => {
  const dialog = await createFromBuilder(page);
  await page.keyboard.press('1');
  const close = dialog.getByRole('button', { name: 'Close assignments' });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Next step' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('0 of 0 correct')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assignments', exact: true })).toBeFocused();
});

test('flushes the latest edit when closing authoring before the autosave delay', async ({
  page,
}) => {
  let dialog = await createFromBuilder(page, 'Close and resume');
  await dialog.getByRole('button', { name: '3. Questions' }).click();
  await dialog.getByRole('button', { name: 'Add manual question' }).click();
  await dialog
    .getByRole('textbox', { name: 'Prompt', exact: true })
    .fill('Last edit before closing');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Assignments', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Assignments', exact: true });
  await dialog.getByRole('button', { name: 'Refresh drafts' }).click();
  await dialog.getByRole('button', { name: 'Resume draft: Close and resume', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue(
    'Last edit before closing',
  );
});

test('reviews invalid edits and blocks export until corrected', async ({ page }) => {
  const dialog = await createFromBuilder(page);
  await dialog.getByRole('button', { name: '3. Questions' }).click();
  await dialog.getByLabel('Choice 1', { exact: true }).fill('');
  await dialog.getByLabel('Focus byte offset', { exact: true }).fill('9999');
  await dialog.getByRole('button', { name: '4. Review' }).click();
  await expect(dialog.getByText(/Error: Question 1/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Download assignment' })).toBeDisabled();
  await dialog.getByRole('button', { name: '3. Questions' }).click();
  await dialog.getByLabel('Choice 1', { exact: true }).fill('Repaired answer');
  await dialog.getByLabel('Focus byte offset', { exact: true }).fill('0');
  await dialog.getByRole('button', { name: '4. Review' }).click();
  await expect(dialog.getByRole('button', { name: 'Download assignment' })).toBeEnabled();
});

test('selects a saved stack and a chosen composed-scenario step', async ({ page }) => {
  await page.goto('/#/builder');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name for the saved stack' }).fill('Saved request');
  await page.getByRole('textbox', { name: 'Name for the saved stack' }).press('Enter');
  await page.goto('/#/scenario');
  await page.getByRole('button', { name: 'Compose', exact: true }).click();
  const composer = page.getByRole('region', { name: 'Scenario composer' });
  await composer.getByRole('button', { name: 'Add current packet' }).click();
  await composer.getByRole('textbox', { name: 'Step 2 label' }).fill('Selected response');
  await composer.getByRole('button', { name: 'Save locally' }).click();
  await expect(composer.getByRole('status')).toHaveText('Saved');
  const dialog = await openAssignments(page);
  await dialog.getByRole('button', { name: 'Create assignment', exact: true }).click();
  await dialog.getByLabel('Title', { exact: true }).fill('Multiple sources');
  await dialog.getByRole('button', { name: '2. Packets' }).click();
  await dialog
    .getByRole('button', {
      name: 'Add saved stack: Saved request',
      exact: true,
    })
    .click();
  await dialog
    .getByRole('button', {
      name: 'Add scenario step 2: Selected response',
      exact: true,
    })
    .click();
  await dialog.getByRole('button', { name: '4. Review' }).click();
  const { quiz } = await downloadedPackage(page);
  expect(quiz.packets.map((item: { source: { kind: string } }) => item.source.kind)).toEqual([
    'saved-stack',
    'scenario',
  ]);
  expect(quiz.packets[1].label).toBe('Selected response');
  expect(
    quiz.questions.some((item: { packetId: string }) => item.packetId === quiz.packets[1].id),
  ).toBe(true);
});

for (const theme of ['dark', 'light'] as const) {
  test(`authoring steps meet automated WCAG A/AA checks in ${theme} mode`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('pv-theme', value), theme);
    const dialog = await createFromBuilder(page);
    for (const step of ['1. Details', '2. Packets', '3. Questions', '4. Review']) {
      await dialog.getByRole('button', { name: step, exact: true }).click();
      const results = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Assignments', exact: true })).toBeFocused();
  });
}
