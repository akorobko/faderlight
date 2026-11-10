// Key settings in a browser: the plugin's Property Inspector page beside the deck, connected as
// the Stream Deck app connects it. Screenshots go to renders/property-inspector/. Each test puts
// back what it changed, since the server keeps key settings for the other tests.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const SHOTS = join(import.meta.dirname, '../../../renders/property-inspector');

test.use({ viewport: { width: 1260, height: 620 } });

type Views = Record<string, Record<string, unknown> | undefined>;

async function shows(page: Page, id: string, expected: Record<string, unknown>): Promise<void> {
  await expect
    .poll(async () => ((await (await page.request.get('/api/views')).json()) as Views)[id], {
      timeout: 10_000,
    })
    .toMatchObject(expected);
}

const key = (page: Page, id: string) => page.locator(`.key[data-id="${id}"]`);
const panel = (page: Page) => page.frameLocator('#inspector iframe');

async function inspect(page: Page, profile: 'console' | 'own', id: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('body[data-ready="true"]')).toBeVisible();
  await page.getByRole('button', { name: profile === 'own' ? 'My page' : 'Console' }).click();
  await page.getByRole('button', { name: 'Key settings' }).click();
  await key(page, id).click();
  await expect(panel(page).locator('body[data-ready="true"]')).toBeAttached();
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400);
  await page.locator('main').screenshot({ path: join(SHOTS, `${name}.png`) });
}

test('a Channel key picks its channel by name, and the key follows', async ({ page }) => {
  await inspect(page, 'own', 'own:2,0');
  const pi = panel(page);
  await expect(pi.getByRole('heading')).toHaveText('Channel');
  await expect(pi.locator('.summary')).toHaveText('Input Mic 9 · Vocal.');
  await expect(pi.getByRole('status')).toHaveText('Connected to Fireface UFX III');
  const channel = pi.getByLabel('Channel');
  await expect(channel.locator('option')).toHaveText([
    'First channel',
    'AN 1/2 · Synth',
    'Mic 9 · Vocal',
    'Mic 10 · Guitar',
    'Mic 11/12 · Room',
  ]);
  await shot(page, 'channel');
  await channel.selectOption({ label: 'Mic 11/12 · Room' });
  await expect(pi.locator('.summary')).toHaveText('Input Mic 11/12 · Room.');
  await shows(page, 'own:2,0', { kind: 'channel', name: 'Room' });
  await channel.selectOption({ label: 'Mic 9 · Vocal' });
  await shows(page, 'own:2,0', { kind: 'channel', name: 'Vocal' });
});

test('a new row starts on its first channel', async ({ page }) => {
  await inspect(page, 'own', 'own:3,0');
  const pi = panel(page);
  await pi.getByLabel('Row').selectOption({ label: 'Playback' });
  await expect(pi.getByLabel('Channel')).toHaveValue('null');
  await shows(page, 'own:3,0', { kind: 'channel', name: 'DAW' });
  await pi.getByLabel('Row').selectOption({ label: 'Inputs' });
  await pi.getByLabel('Channel').selectOption({ label: 'Mic 10 · Guitar' });
  await shows(page, 'own:3,0', { kind: 'channel', name: 'Guitar' });
});

test('an output key offers Main and the Phones as TotalMix assigns them', async ({ page }) => {
  await inspect(page, 'own', 'own:2,1');
  const output = panel(page).getByLabel('Output');
  await expect(output.locator('optgroup')).toHaveCount(2);
  await expect(output.locator('optgroup').first()).toHaveAttribute('label', 'Follows TotalMix');
  await output.selectOption({ label: 'Phones 1 (PH 9/10 · Phones 1)' });
  await shows(page, 'own:2,1', { kind: 'output', name: 'Phones 1' });
  await output.selectOption({ label: 'Main (AN 1/2 · Main)' });
  await shows(page, 'own:2,1', { kind: 'output', name: 'Main' });
});

test('a Console Slot says what it shows, and opens the Control Center', async ({ page }) => {
  await inspect(page, 'console', 'console:1,1');
  const pi = panel(page);
  await expect(pi.locator('.summary')).toHaveText('Now: Input Mic 9 · Vocal.');
  await expect(pi.locator('.note')).toContainText('The layout is set up in the Control Center.');
  await expect(pi.locator('select')).toHaveCount(0);
  await shot(page, 'console-slot');
  await pi.getByRole('button', { name: 'Open Control Center' }).click();
  await expect(page.locator('#toast a')).toBeVisible();
});
