import { expect, test } from '@playwright/test';

test('browses bindings, offers a list alternative, and opens a suggested stack', async ({
  page,
}) => {
  await page.goto('/#/map');
  await expect(page.getByRole('heading', { name: 'Encapsulation Map' })).toBeVisible();

  const ipv4Map = page.getByLabel('Relationships for IPv4');
  await ipv4Map
    .getByRole('listitem')
    .filter({ hasText: 'Ethernet II' })
    .getByRole('button', { name: 'EtherType 0x0800' })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'Ethernet II carries IPv4 via EtherType 0x0800',
  );

  await page.getByRole('button', { name: 'List', exact: true }).click();
  const relationships = page.getByRole('table');
  await expect(relationships).toBeVisible();
  await expect(relationships).toContainText('Ethernet II');
  await expect(relationships).toContainText('IPv4');

  const search = page.getByRole('searchbox', { name: 'Search protocols' });
  await search.fill('IPv6');
  await expect(page.getByRole('button', { name: 'IPv6network', exact: true })).toBeVisible();
  await search.clear();

  await page.getByRole('combobox', { name: 'Target protocol' }).selectOption('vxlan');
  const path = page.getByRole('listitem').filter({ hasText: 'VXLAN' }).filter({
    has: page.getByRole('button', { name: 'Open in Builder' }),
  }).first();
  await expect(path).toContainText('UDP port 4789');
  await path.getByRole('button', { name: 'Open in Builder' }).click();

  await expect(page).toHaveURL(/#\/builder$/);
  await expect(page.getByRole('button', { name: 'Reorder VXLAN layer' })).toBeVisible();
});
