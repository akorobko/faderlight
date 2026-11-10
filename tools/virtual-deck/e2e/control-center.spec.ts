// The Control Center in a browser, opened as a person would: a tap on the Status key offers a
// link, and the link opens the Connection page. Screenshots go to renders/control-center/.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const SHOTS = join(import.meta.dirname, '../../../renders/control-center');

test.use({ viewport: { width: 1280, height: 900 } });

/** A one-time link, as the Status key would give one. */
async function link(page: Page, section?: string): Promise<string> {
  const query = section === undefined ? '' : `?section=${section}`;
  const r = await page.request.get(`/api/control-center${query}`);
  return ((await r.json()) as { url: string }).url;
}

async function open(page: Page, section?: string): Promise<void> {
  await page.goto(await link(page, section));
  await expect(page.getByTestId('mixer-status')).toContainText('Live');
}

/** The whole page, the window (`'window'`, for the save bar that floats in it) or one part. */
async function shot(page: Page, name: string, what = 'page'): Promise<void> {
  // Let the once-a-second connection report arrive.
  await page.waitForTimeout(1200);
  const path = join(SHOTS, `${name}.png`);
  await (what === 'page' || what === 'window'
    ? page.screenshot({ path, fullPage: what === 'page' })
    : page.locator(what).screenshot({ path }));
}

test('a tap on the Status key offers a link that opens the Connection page', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready="true"]')).toBeVisible();
  await expect
    .poll(async () => {
      const views = (await (await page.request.get('/api/views')).json()) as Record<
        string,
        { link?: string } | undefined
      >;
      return views['console:6,0']?.link;
    })
    .toBe('live');
  await page.locator('.key[data-id="console:6,0"]').click();
  const offer = page.locator('#toast a');
  await expect(offer).toBeVisible();
  const [cc] = await Promise.all([context.waitForEvent('page'), offer.click()]);
  await expect(cc.getByRole('heading', { level: 1 })).toHaveText('Connection');
  await expect(cc.getByTestId('mixer-status')).toContainText('Live');
  // The token is gone from the address bar; the section is kept.
  expect(new URL(cc.url()).search).toBe('');
  expect(new URL(cc.url()).hash).toBe('#connection');
});

test('the Setup Assistant finds TotalMix answering and the mixer read', async ({ page }) => {
  await open(page, 'connection');
  const check = (id: string) => page.locator(`[data-check="${id}"]`);
  await expect(check('port')).toHaveClass(/check-ok/);
  await expect(check('reply')).toHaveClass(/check-ok/);
  await expect(check('sync')).toHaveClass(/check-ok/);
  await expect(check('names')).toContainText("Read from TotalMix's state file");
  await expect(page.locator('.facts')).toContainText('127.0.0.1');
  await shot(page, 'connection');
});

test('the packet log shows what TotalMix sends, filtered', async ({ page }) => {
  await open(page, 'connection');
  const rows = page.locator('#packets tbody tr');
  await expect(rows.first()).toBeVisible();
  await page.getByRole('textbox', { name: 'Filter' }).first().fill('/mix/in');
  await expect(rows.first().locator('.address')).toContainText('/mix/in');
  // Only from TotalMix: no arrows pointing to it.
  await page.getByLabel('To TotalMix').uncheck();
  await expect(page.locator('#packets tr.out')).toHaveCount(0);
  await page.getByLabel('To TotalMix').check();
  await page.getByRole('textbox', { name: 'Filter' }).first().fill('');
  await page.getByRole('button', { name: 'Read the mixer again' }).click();
  await expect(page.locator('#packets tr.out').first()).toBeVisible();
  await shot(page, 'packet-log', '#packets');
});

test('the mixer state lists every value the plugin holds', async ({ page }) => {
  await open(page, 'connection');
  await page.locator('#state').getByRole('button', { name: 'Show' }).click();
  const table = page.locator('#state tbody tr');
  await expect(table.first()).toBeVisible();
  await page.locator('#state').getByRole('textbox', { name: 'Filter' }).fill('mute');
  await expect(table.first().locator('.address')).toContainText('mute');
});

test('an edit shows the save bar, Discard takes it back', async ({ page }) => {
  await open(page, 'connection');
  const host = page.getByRole('textbox', { name: 'Computer running TotalMix' });
  await expect(host).toHaveValue('127.0.0.1');
  await host.fill('192.168.1.20');
  const bar = page.getByRole('region', { name: 'Unsaved changes' });
  await expect(bar).toContainText('You have unsaved changes.');
  await shot(page, 'save-bar', 'window');
  await bar.getByRole('button', { name: 'Discard' }).click();
  await expect(bar).toBeHidden();
  await expect(host).toHaveValue('127.0.0.1');
});

test('a link works once: another browser gets a refusal', async ({ page, browser }) => {
  const url = await link(page);
  await page.goto(url);
  await expect(page.getByTestId('mixer-status')).toBeVisible();
  const other = await browser.newContext();
  const stranger = await other.newPage();
  const response = await stranger.goto(url);
  expect(response?.status()).toBe(403);
  await expect(stranger.locator('body')).toContainText('already been used');
  await other.close();
});
