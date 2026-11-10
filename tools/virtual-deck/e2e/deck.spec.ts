// The virtual deck in a browser: the Console, a tap, the Channel Detail overlay, paging, and
// "My page" with the Console launcher. One server for all tests, so they run in order.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const SHOTS = join(import.meta.dirname, '../../../renders/virtual-deck');

type Views = Record<string, Record<string, unknown> | undefined>;

const views = async (page: Page): Promise<Views> =>
  (await (await page.request.get('/api/views')).json()) as Views;

/** Waits until the key shows a view matching `expected`. */
async function shows(page: Page, id: string, expected: Record<string, unknown>): Promise<void> {
  await expect
    .poll(async () => (await views(page))[id], { timeout: 10_000 })
    .toMatchObject(expected);
}

const key = (page: Page, profile: string, column: number, row: number) =>
  page.locator(`.key[data-id="${profile}:${String(column)},${String(row)}"]`);

async function longPress(page: Page, profile: string, column: number, row: number) {
  const box = await key(page, profile, column, row).boundingBox();
  if (!box) throw new Error('key not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
}

async function shot(page: Page, name: string) {
  // Let the last frames arrive (meters animate at 12 frames per second).
  await page.waitForTimeout(400);
  await page.locator('main').screenshot({ path: join(SHOTS, `${name}.png`) });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body[data-ready="true"]')).toBeVisible();
});

test('shows the Console page once the simulator is live', async ({ page }) => {
  await expect(page.locator('.key[data-id^="console:"]')).toHaveCount(32);
  await shows(page, 'console:6,0', { kind: 'status', link: 'live' });
  await shows(page, 'console:1,1', { kind: 'channel', name: 'Vocal' });
  await shows(page, 'console:0,0', { kind: 'snapshot', n: 1, name: 'Tracking' });
  await shows(page, 'console:0,2', { kind: 'channel', name: 'DAW' });
  await shot(page, 'console');
});

test('a tap on a channel key mutes it, another unmutes it', async ({ page }) => {
  await key(page, 'console', 1, 1).click();
  await shows(page, 'console:1,1', { muted: true, pending: false });
  await key(page, 'console', 1, 1).click();
  await shows(page, 'console:1,1', { muted: false });
});

test('a long press opens the Channel Detail overlay, Back closes it', async ({ page }) => {
  await longPress(page, 'console', 1, 1);
  await shows(page, 'console:0,0', { kind: 'control', word: 'BACK' });
  await shows(page, 'console:1,0', { kind: 'channel', name: 'Vocal' });
  await key(page, 'console', 1, 2).click();
  await shows(page, 'console:1,2', { lit: true });
  await shot(page, 'channel-detail');
  await key(page, 'console', 0, 0).click();
  await shows(page, 'console:0,0', { kind: 'snapshot', n: 1 });
});

test('the page key goes to the Inputs and Outputs pages, the top-right key back', async ({
  page,
}) => {
  await key(page, 'console', 7, 0).click();
  await shows(page, 'console:0,0', { kind: 'channel', style: 'meter', name: 'Synth' });
  await shows(page, 'console:7,0', { kind: 'page', name: 'CONSOLE' });
  await shot(page, 'inputs');
  await key(page, 'console', 7, 3).click();
  await shows(page, 'console:0,0', { kind: 'output', name: 'Main' });
  await shot(page, 'outputs');
  await key(page, 'console', 7, 0).click();
  await shows(page, 'console:0,0', { kind: 'snapshot' });
});

test('My page: specific actions, the Console launcher, and Channel Detail from there', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'My page' }).click();
  await expect(page.locator('.key[data-id^="own:"]')).toHaveCount(14);
  await shows(page, 'own:2,0', { kind: 'channel', name: 'Vocal' });
  await shot(page, 'my-page');

  // A long press on a channel key of My page opens the overlay on the Console...
  await longPress(page, 'own', 3, 0);
  await expect(page.locator('.key[data-id^="console:"]')).toHaveCount(32);
  await shows(page, 'console:1,0', { name: 'Guitar' });
  // ...and Back returns to My page.
  await key(page, 'console', 7, 3).click();
  await expect(page.locator('.key[data-id^="own:"]')).toHaveCount(14);

  await key(page, 'own', 7, 1).click();
  await expect(page.locator('.key[data-id^="console:"]')).toHaveCount(32);
  // Exit, bottom right on the Console, goes back to My page.
  await key(page, 'console', 7, 3).click();
  await expect(page.locator('.key[data-id^="own:"]')).toHaveCount(14);
});
