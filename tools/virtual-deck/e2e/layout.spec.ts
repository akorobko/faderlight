// The Control Center's layout builder and backup in a browser: keys dragged onto the grid reach
// the virtual deck's Console when saved, templates replace the layout, and layouts and settings
// go out to files and come back. Screenshots go to renders/control-center/. Each test puts back
// the default layout, since the server keeps the settings for the tests after it.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const SHOTS = join(import.meta.dirname, '../../../renders/control-center');

test.use({ viewport: { width: 1280, height: 900 } });

type Views = Record<string, Record<string, unknown> | undefined>;

async function open(page: Page, section: string): Promise<void> {
  await page.request.post('/api/profile', { data: { profile: 'console' } });
  const r = await page.request.get(`/api/control-center?section=${section}`);
  await page.goto(((await r.json()) as { url: string }).url);
  await expect(page.getByTestId('mixer-status')).toContainText('Live');
}

async function shows(page: Page, id: string, expected: Record<string, unknown>): Promise<void> {
  await expect
    .poll(async () => ((await (await page.request.get('/api/views')).json()) as Views)[id], {
      timeout: 10_000,
    })
    .toMatchObject(expected);
}

const bar = (page: Page) => page.getByRole('region', { name: 'Unsaved changes' });

async function save(page: Page): Promise<void> {
  await bar(page).getByRole('button', { name: 'Save' }).click();
  await expect(bar(page)).toBeHidden();
}

/** Key `row.column` of the grid, as numbered on the page (from 1). */
const cell = (page: Page, at: string) =>
  page.getByRole('button', { name: new RegExp(`^Key ${at}:`) });
const chip = (page: Page, label: string) =>
  page.getByRole('complementary', { name: 'Keys to add' }).getByRole('button', {
    name: label,
    exact: true,
  });

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: join(SHOTS, `${name}.png`),
    fullPage: true,
    style: '.savebar { position: static; margin-top: 4px; }',
  });
}

test('the grid shows the Console page with the keys as the deck draws them', async ({ page }) => {
  await open(page, 'layout');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Layout');
  await expect(page.getByRole('tab')).toHaveText(['Console', 'Inputs', 'Outputs']);
  await expect(cell(page, '1.1')).toHaveAccessibleName('Key 1.1: Snapshot 1');
  await expect(cell(page, '2.1')).toHaveAccessibleName('Key 2.1: Bank 1 · 1');
  await expect(cell(page, '4.8')).toHaveAccessibleName('Key 4.8: Exit Console');
  await expect(cell(page, '1.1').locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await cell(page, '2.2').click();
  await expect(page.locator('#key')).toContainText('Bank 1 · 2');
  await expect(page.locator('#page')).toContainText('Bank 2');
  await shot(page, 'layout');
  await page.getByRole('tab', { name: 'Inputs' }).click();
  await expect(cell(page, '1.8')).toHaveAccessibleName('Key 1.8: To Console');
});

test('a key dragged onto the grid reaches the deck when saved', async ({ page }) => {
  await open(page, 'layout');
  // The empty key left of Exit.
  await expect(cell(page, '4.7')).toHaveAccessibleName('Key 4.7: Empty');
  await chip(page, 'Talkback').dragTo(cell(page, '4.7'));
  await expect(cell(page, '4.7')).toHaveAccessibleName('Key 4.7: Talkback');
  // A key dragged onto another swaps with it.
  await cell(page, '1.1').dragTo(cell(page, '1.2'));
  await expect(cell(page, '1.1')).toHaveAccessibleName('Key 1.1: Snapshot 2');
  await expect(cell(page, '1.2')).toHaveAccessibleName('Key 1.2: Snapshot 1');
  // Or select a key and pick one from the list.
  await cell(page, '1.3').click();
  await chip(page, 'Snapshot 8').click();
  await expect(cell(page, '1.3')).toHaveAccessibleName('Key 1.3: Snapshot 8');
  await page.locator('#key').getByLabel('Snapshot').selectOption({ label: 'Snapshot 7' });
  await expect(cell(page, '1.3')).toHaveAccessibleName('Key 1.3: Snapshot 7');
  await shot(page, 'layout-edit');
  await save(page);
  await shows(page, 'console:6,3', { kind: 'toggle', function: 'talkback' });
  await shows(page, 'console:0,0', { kind: 'snapshot', n: 2 });
  await shows(page, 'console:2,0', { kind: 'snapshot', n: 7 });

  // Studio Console again: the settings have no layout of their own.
  await page.locator('[data-template="console"]').getByRole('button').click();
  await save(page);
  await shows(page, 'console:0,0', { kind: 'snapshot', n: 1 });
  await expect(page.locator('[data-template="console"]').getByRole('button')).toBeDisabled();
});

test('a template replaces the layout, and its pages show on the deck', async ({ page }) => {
  await open(page, 'layout');
  await page.locator('[data-template="monitoring"]').getByRole('button').click();
  await expect(page.getByRole('tab')).toHaveText(['Monitor']);
  await expect(cell(page, '2.1')).toHaveAccessibleName('Key 2.1: Main');
  await save(page);
  await shows(page, 'console:0,1', { kind: 'output', role: 'main' });
  // A page of its own: added, named, and taken out again.
  await page.getByRole('button', { name: 'Add page' }).click();
  await expect(page.getByRole('tab')).toHaveText(['Monitor', 'Page 2']);
  await page.getByRole('textbox', { name: 'Page name' }).fill('Extras');
  await expect(page.getByRole('tab')).toHaveText(['Monitor', 'Extras']);
  await page.getByRole('button', { name: 'Delete page' }).click();
  await expect(page.getByRole('tab')).toHaveText(['Monitor']);
  await expect(bar(page)).toBeHidden();
  await page.locator('[data-template="console"]').getByRole('button').click();
  await save(page);
  await shows(page, 'console:0,1', { kind: 'channel' });
});

test('a layout goes out to a file and comes back in', async ({ page }, info) => {
  await open(page, 'layout');
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export layout' }).click(),
  ]);
  expect(file.suggestedFilename()).toBe('faderlight-layout.json');
  const exported = JSON.parse(await readFile(await file.path(), 'utf8')) as {
    faderlight: string;
    layout: { pages: { name: string; keys: unknown[] }[] };
  };
  expect(exported.faderlight).toBe('layout');
  expect(exported.layout.pages.map((p) => p.name)).toEqual(['Console', 'Inputs', 'Outputs']);

  // The same layout with the first page renamed and one key that is not one.
  const first = exported.layout.pages[0];
  if (!first) throw new Error('no page');
  first.name = 'Mine';
  first.keys[0] = { type: 'snapshot', n: 99 };
  const path = info.outputPath('mine.json');
  await writeFile(path, JSON.stringify(exported));
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import layout' }).click(),
  ]);
  await chooser.setFiles(path);
  await expect(page.getByRole('status')).toContainText('layout.pages.0.keys.0: not a key');
  await expect(page.getByRole('tab')).toHaveText(['Mine', 'Inputs', 'Outputs']);
  await expect(cell(page, '1.1')).toHaveAccessibleName('Key 1.1: Empty');
  await bar(page).getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('tab')).toHaveText(['Console', 'Inputs', 'Outputs']);
});

test('Backup exports every setting, imports them checked, and resets', async ({ page }, info) => {
  await open(page, 'backup');
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export settings' }).click(),
  ]);
  expect(file.suggestedFilename()).toBe('faderlight-settings.json');
  const settings = JSON.parse(await readFile(await file.path(), 'utf8')) as Record<string, unknown>;
  expect(settings).toMatchObject({ version: 3, theme: 'dark' });

  const path = info.outputPath('backup.json');
  await writeFile(
    path,
    JSON.stringify({ ...settings, theme: 'neon', snapshots: { '2': 'From the file' } }),
  );
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import settings' }).click(),
  ]);
  await chooser.setFiles(path);
  await expect(page.getByRole('status')).toContainText('theme: expected one of dark');
  await expect(bar(page)).toContainText('You have unsaved changes.');
  await shot(page, 'backup');
  await save(page);
  await shows(page, 'console:1,0', { kind: 'snapshot', name: 'From the file' });

  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await save(page);
  await shows(page, 'console:1,0', { kind: 'snapshot', name: 'Overdubs' });
});
