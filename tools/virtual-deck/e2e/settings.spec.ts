// The Control Center's settings pages in a browser: what is saved there reaches the keys of the
// virtual deck. Screenshots go to renders/control-center/. Each test puts back what it saved,
// since the server keeps the settings for the tests after it.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const SHOTS = join(import.meta.dirname, '../../../renders/control-center');

test.use({ viewport: { width: 1280, height: 900 } });

type Views = Record<string, Record<string, unknown> | undefined>;

/** Opens a section; `profile`: the profile the virtual deck shows (only its keys have views). */
async function open(page: Page, section: string, profile = 'console'): Promise<void> {
  await page.request.post('/api/profile', { data: { profile } });
  const r = await page.request.get(`/api/control-center?section=${section}`);
  await page.goto(((await r.json()) as { url: string }).url);
  await expect(page.getByTestId('mixer-status')).toContainText('Live');
}

/** Waits until the virtual deck's key `id` shows `expected`. */
async function shows(page: Page, id: string, expected: Record<string, unknown>): Promise<void> {
  await expect
    .poll(async () => ((await (await page.request.get('/api/views')).json()) as Views)[id], {
      timeout: 10_000,
    })
    .toMatchObject(expected);
}

async function names(page: Page, row: number): Promise<string[]> {
  const views = (await (await page.request.get('/api/views')).json()) as Views;
  return Array.from({ length: 8 }, (_, c) => {
    const v = views[`console:${String(c)},${String(row)}`];
    return typeof v?.name === 'string' ? v.name : '';
  });
}

async function save(page: Page): Promise<void> {
  const bar = page.getByRole('region', { name: 'Unsaved changes' });
  await bar.getByRole('button', { name: 'Save' }).click();
  await expect(bar).toBeHidden();
}

/** The whole page; the save bar, which floats over the window, goes below the last card. */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(800);
  await page.screenshot({
    path: join(SHOTS, `${name}.png`),
    fullPage: true,
    style: '.savebar { position: static; margin-top: 4px; }',
  });
}

test('names, colours and hidden channels from Device & Channels reach the keys', async ({
  page,
}) => {
  await open(page, 'channels');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Device & Channels');
  await expect(page.locator('#device')).toContainText('Fireface UFX III');
  // Snapshot names: TotalMix's are the placeholders.
  const snapshot2 = page.getByRole('textbox', { name: 'Name of snapshot 2' });
  await expect(snapshot2).toHaveAttribute('placeholder', 'Overdubs');
  await snapshot2.fill('Vocals only');
  // A channel's name, colour and whether the Console shows it.
  const vocal = page.locator('[data-channel="input/8"]');
  await expect(vocal).toContainText('Vocal');
  await vocal.getByLabel('Name of Mic 9').fill('Lead vox');
  await vocal.getByLabel('Colour of Mic 9').fill('#ff0000');
  await expect(vocal.getByRole('button', { name: 'Reset' })).toBeVisible();
  await page.locator('[data-channel="input/10"]').getByLabel('Show').uncheck();
  await shot(page, 'channels');
  await save(page);

  await shows(page, 'console:1,0', { kind: 'snapshot', name: 'Vocals only' });
  await shows(page, 'console:1,1', { kind: 'channel', name: 'Lead vox', color: '#ff0000' });
  await expect
    .poll(async () => (await names(page, 1)).slice(0, 4))
    .toEqual(['Synth', 'Lead vox', 'Guitar', '']);

  // Emptied again, everything comes back from TotalMix.
  await snapshot2.fill('');
  await vocal.getByLabel('Name of Mic 9').fill('');
  await vocal.getByRole('button', { name: 'Reset' }).click();
  await page.locator('[data-channel="input/10"]').getByLabel('Show').check();
  await save(page);
  await shows(page, 'console:1,0', { kind: 'snapshot', name: 'Overdubs' });
  await expect
    .poll(async () => (await names(page, 1)).slice(0, 4))
    .toEqual(['Synth', 'Vocal', 'Guitar', 'Room']);
});

test('Level Presets: a level set there is the one the key restores', async ({ page }) => {
  await open(page, 'channels', 'own');
  const presets = page.locator('#presets');
  await expect(presets).toContainText('No levels saved yet.');
  const add = presets.getByLabel('Add a preset for');
  await add.selectOption({ label: 'Main' });
  await add.selectOption({ label: 'Main' });
  await expect(presets.locator('[data-preset]')).toHaveCount(2);
  const level = presets.getByRole('spinbutton', { name: 'Level of Main preset 2' });
  await expect(level).toHaveValue('-20');
  await level.fill('-14.5');
  await presets.screenshot({
    path: join(SHOTS, 'level-presets.png'),
    style: '.savebar { display: none; }',
  });
  await save(page);
  // The own page has a Level Preset key for Main preset 2.
  await shows(page, 'own:2,2', { kind: 'control', word: '−14.5 dB' });
  for (const key of ['main/1', 'main/2']) {
    await presets.locator(`[data-preset="${key}"]`).getByRole('button', { name: 'Remove' }).click();
  }
  await save(page);
  await expect(presets).toContainText('No levels saved yet.');
  await shows(page, 'own:2,2', { kind: 'control', word: 'SET' });
});

test('the Appearance page maps a TotalMix colour number to a key colour', async ({ page }) => {
  await open(page, 'appearance');
  const green = page.locator('[data-color="6"]');
  await expect(green).toContainText('Green');
  await expect(green).toContainText('Guitar');
  await expect(page.locator('[data-color="2"]')).toContainText('Grey');
  await green.getByLabel('Key colour for TotalMix colour 6').fill('#123456');
  await shot(page, 'appearance');
  await save(page);
  await shows(page, 'console:2,1', { name: 'Guitar', color: '#123456' });
  await green.getByRole('button', { name: 'Reset' }).click();
  await save(page);
  await shows(page, 'console:2,1', { name: 'Guitar', color: 6 });
});

test('a section opened from the navigation shows the mixer at once', async ({ page }) => {
  // The page header follows the mixer already, so the section joins a topic that is running.
  await open(page, 'connection');
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Appearance' })
    .click();
  await expect(page.locator('[data-color="6"]')).toContainText('Guitar');
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Device & Channels' })
    .click();
  await expect(page.locator('[data-channel="input/9"]')).toContainText('Guitar');
});

test('the Behaviour page keeps gesture timings within their range', async ({ page }) => {
  await open(page, 'behaviour');
  const hold = page.getByRole('spinbutton', { name: 'Long press' });
  await expect(hold).toHaveValue('450');
  await hold.fill('5000');
  const bar = page.getByRole('region', { name: 'Unsaved changes' });
  await bar.getByRole('button', { name: 'Save' }).click();
  // The plugin keeps it within 200-2000 ms and says so.
  await expect(hold).toHaveValue('2000');
  await expect(bar).toContainText('gestures.longPressMs: 5000 is above 2000');
  await shot(page, 'behaviour');
  await bar.getByRole('button', { name: 'OK' }).click();
  await expect(bar).toBeHidden();
  await hold.fill('600');
  await save(page);
  await page.reload();
  await expect(page.getByRole('spinbutton', { name: 'Long press' })).toHaveValue('600');
  await page.getByRole('button', { name: 'Use the defaults' }).first().click();
  await save(page);
  await expect(page.getByRole('spinbutton', { name: 'Long press' })).toHaveValue('450');
});
