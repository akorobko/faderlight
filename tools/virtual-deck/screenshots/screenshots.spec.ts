// Takes the pictures in docs/images/ (README, website): the Console, Channel Detail and Inputs
// pages of the deck, the Setup Assistant and the layout builder. Run with `npm run screenshots` after a
// change to the keys or the Control Center, and commit the PNGs that changed.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const OUT = join(import.meta.dirname, '../../../docs/images');

type Views = Record<string, Record<string, unknown> | undefined>;

async function shows(page: Page, id: string, expected: Record<string, unknown>): Promise<void> {
  await expect
    .poll(async () => ((await (await page.request.get('/api/views')).json()) as Views)[id], {
      timeout: 10_000,
    })
    .toMatchObject(expected);
}

const key = (page: Page, column: number, row: number) =>
  page.locator(`.key[data-id="console:${String(column)},${String(row)}"]`);

/** The deck alone, without the virtual deck's toolbar. */
async function deck(page: Page, name: string): Promise<void> {
  // Let the meters run for a few frames (12 a second).
  await page.waitForTimeout(1500);
  await page.locator('#deck').screenshot({ path: join(OUT, `${name}.png`) });
}

async function controlCenter(page: Page, section: string): Promise<void> {
  const r = await page.request.get(`/api/control-center?section=${section}`);
  await page.goto(((await r.json()) as { url: string }).url);
  await expect(page.getByTestId('mixer-status')).toContainText('Live');
  // Let the once-a-second reports arrive.
  await page.waitForTimeout(1500);
}

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/profile', { data: { profile: 'console' } });
  await page.goto('/');
  await expect(page.locator('body[data-ready="true"]')).toBeVisible();
  await shows(page, 'console:6,0', { kind: 'status', link: 'live' });
});

test('the Console', async ({ page }) => {
  await shows(page, 'console:3,1', { kind: 'channel', name: 'Vocal' });
  await shows(page, 'console:6,2', { kind: 'output', name: 'Stream' });
  await deck(page, 'console');
});

test('Channel Detail of the vocal', async ({ page }) => {
  const box = await key(page, 3, 1).boundingBox();
  if (!box) throw new Error('key not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await shows(page, 'console:0,0', { kind: 'control', word: 'BACK' });
  await shows(page, 'console:1,0', { kind: 'channel', name: 'Vocal' });
  // Choose the send to Phones 1 (the third send key), so the send and pan keys show it.
  await key(page, 2, 2).click();
  await shows(page, 'console:2,2', { lit: true });
  await deck(page, 'channel-detail');
  await key(page, 0, 0).click();
  await shows(page, 'console:0,0', { kind: 'snapshot', n: 1 });
});

test('the Inputs page', async ({ page }) => {
  await key(page, 7, 0).click();
  await shows(page, 'console:0,0', { kind: 'channel', style: 'meter', name: 'Keys' });
  await deck(page, 'inputs');
  await key(page, 7, 0).click();
  await shows(page, 'console:0,0', { kind: 'snapshot' });
});

test.describe('Control Center', () => {
  test.use({ viewport: { width: 1280, height: 860 } });

  // Before the Setup Assistant, whose change marks snapshot 1 as edited.
  test('the layout builder', async ({ page }) => {
    await controlCenter(page, 'layout');
    await page.screenshot({ path: join(OUT, 'layout-builder.png') });
  });

  test('the Setup Assistant', async ({ page }) => {
    await controlCenter(page, 'connection');
    // A fader moved in TotalMix, and back: the last check turns green.
    const move = (value: number) =>
      page.request.post('/api/totalmix', { data: { address: '/output/2/volume', value } });
    await move(-23);
    await move(-24);
    await expect(page.locator('[data-check="changes"]')).toHaveClass(/check-ok/, {
      timeout: 10_000,
    });
    await page.locator('#setup').screenshot({ path: join(OUT, 'setup-assistant.png') });
  });
});
