import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const customLibrary = JSON.stringify({
  app: 'proto-viz',
  version: 1,
  protocols: [
    {
      id: 'classroom-note',
      name: 'Classroom Note',
      layerHint: 'application',
      source: 'custom',
      fields: [
        { id: 'body', name: 'Body', type: 'bytes', bitLength: 'auto', default: { $bytes: 'AQID' } },
      ],
      providesNamespaces: [],
      encapsulations: [],
    },
  ],
});

async function clearWorkspaceStorage(page: Page) {
  await page.evaluate(async () => {
    localStorage.clear();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('proto-viz');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['customProtocols', 'savedStacks'], 'readwrite');
    transaction.objectStore('customProtocols').clear();
    transaction.objectStore('savedStacks').clear();
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
}

test('exports, reviews, and restores a complete workspace', async ({ page }) => {
  await page.goto('/#/library');
  await page.getByLabel('Import library JSON').setInputFiles({
    name: 'classroom-library.json',
    mimeType: 'application/json',
    buffer: Buffer.from(customLibrary),
  });
  await expect(page.getByText('Classroom Note')).toBeVisible();

  await page.goto('/#/builder');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Name for the saved stack').fill('Classroom TCP stack');
  await page.getByLabel('Name for the saved stack').press('Enter');
  await page.getByRole('button', { name: 'Add to compare' }).click();

  // Mounting Scenario creates and persists the composed draft included by export.
  await page.goto('/#/scenario');
  await expect(page.getByRole('heading', { name: 'Scenario Timeline' })).toBeVisible();
  await page.goto('/#/workspace');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download workspace' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('workspace.proto-viz-workspace.json');
  const workspacePath = await download.path();
  expect(workspacePath).not.toBeNull();

  await clearWorkspaceStorage(page);
  await page.reload();
  await page.goto('/#/builder');
  await page.getByRole('button', { name: 'Remove TCP layer' }).click();
  await expect(page.getByText('IP Protocol 6')).not.toBeVisible();
  await page.goto('/#/workspace');

  await page.locator('input[type=file]').setInputFiles(workspacePath!);
  await expect(page.getByRole('heading', { name: 'Review import' })).toBeVisible();
  await expect(page.getByText(/Incoming: 1 protocols, 1 stacks, 1 comparisons, 1 current stack, 1 scenario/)).toBeVisible();

  await page.getByRole('group', { name: 'Protocol import mode' }).getByLabel('replace').check();
  await page.getByRole('group', { name: 'Stack import mode' }).getByLabel('replace').check();
  await page.getByRole('group', { name: 'Comparison import mode' }).getByLabel('replace').check();
  await page.getByLabel(/I understand that selected saved protocols/).check();
  await page.getByRole('button', { name: 'Apply import' }).click();
  await expect(page.getByRole('status')).toContainText('Workspace imported successfully');

  await page.goto('/#/library');
  await expect(page.getByText('Classroom Note')).toBeVisible();
  await page.goto('/#/builder');
  await expect(page.getByRole('button', { name: 'Remove TCP layer' })).toBeVisible();
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.getByText('Classroom TCP stack')).toBeVisible();
  await page.goto('/#/compare');
  await expect(page.getByRole('heading', { name: 'Packet Comparison' })).toBeVisible();
  await expect(page.getByText('Builder packet')).toBeVisible();
  await page.goto('/#/scenario');
  await expect(page.getByRole('option', { name: /Custom · Custom exchange/ })).toBeAttached();
});

test('rejects future workspaces before review and has no accessibility violations', async ({ page }) => {
  await page.goto('/#/workspace');
  await page.locator('input[type=file]').setInputFiles({
    name: 'future.proto-viz-workspace.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      app: 'proto-viz',
      kind: 'workspace',
      version: 999,
      exportedAt: new Date().toISOString(),
    })),
  });
  await expect(page.getByRole('alert')).toContainText('newer than supported version 1');
  await expect(page.getByRole('heading', { name: 'Review import' })).not.toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    .disableRules(['target-size'])
    .analyze();
  expect(results.violations).toEqual([]);
});
