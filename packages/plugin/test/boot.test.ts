// The built plugin, end to end without the Stream Deck app: build it into a temporary folder,
// validate it with the Elgato CLI, start it against a fake app and the simulator, and check that
// it registers, writes its settings, connects to the mixer and draws keys.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from '@faderlight/deck';
import { renderKey, svgDataUrl } from '@faderlight/render';
import { Simulator } from '@faderlight/simulator';
import { buildPlugin } from '../scripts/build.ts';
import { DEBUG_PAGES } from '../src/debug.ts';
import { actionUuid, PLUGIN_UUID } from '../src/ids.ts';
import { FakeStreamDeck, XL, type Json } from './fake-app.ts';

const require = createRequire(import.meta.url);

let tmp: string;
let dir: string;
let sim: Simulator;
let app: FakeStreamDeck;

beforeAll(async () => {
  // The CLI wants the folder to be named after the plugin UUID.
  tmp = mkdtempSync(join(tmpdir(), 'faderlight-plugin-'));
  dir = join(tmp, `${PLUGIN_UUID}.sdPlugin`);
  await buildPlugin({ outDir: dir });
  sim = new Simulator({ portIn: 0, feedbackPort: 'sender', meters: false });
  await sim.start();
  app = new FakeStreamDeck();
  await app.start();
  app.globalSettings = { connection: { host: '127.0.0.1', sendPort: sim.port, listenPort: 0 } };
  await app.launch(dir);
}, 60_000);

afterAll(async () => {
  await app.stop();
  await sim.stop();
  rmSync(tmp, { recursive: true, force: true });
});

describe('the built plugin', () => {
  it('passes the Elgato CLI validation', () => {
    const cli = require.resolve('@elgato/cli/bin/streamdeck.mjs');
    const out = execFileSync(process.execPath, [cli, 'validate', dir, '--no-update-check'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(out).not.toMatch(/error/i);
  }, 30_000);

  it('completes its global settings and keeps the connection settings', async () => {
    const set = await app.waitFor((m) => m.event === 'setGlobalSettings');
    const settings = set.payload as Json;
    expect(settings.version).toBe(SETTINGS_VERSION);
    expect(settings.connection).toEqual({ host: '127.0.0.1', sendPort: sim.port, listenPort: 0 });
    expect(settings.gestures).toEqual(DEFAULT_SETTINGS.gestures);
  });

  it('draws a key that appears and redraws it when the mixer is live', async () => {
    const live = svgDataUrl(
      renderKey({ kind: 'status', link: 'live', device: 'Fireface UFX III' }),
    );
    const drawn = app.waitFor(
      (m) => m.event === 'setImage' && m.context === 'k1' && (m.payload as Json).image === live,
      10_000,
    );
    app.appear('k1', actionUuid('status'), { column: 6, row: 0 });
    await drawn;
  });

  it('mutes a channel when its key is tapped', async () => {
    const channel = actionUuid('channel');
    app.appear('k2', channel, { column: 0, row: 0 }, { bus: 'input', index: 8 });
    await app.waitFor((m) => m.event === 'setImage' && m.context === 'k2');
    const images = app.images('k2').length;
    app.key('keyDown', 'k2', channel);
    app.key('keyUp', 'k2', channel);
    await until(() => sim.mixer.channelValue('input', 8, 'mute') === 1);
    // Drawn again, muted.
    await until(() => app.images('k2').length > images);
  });

  it('opens the Control Center from a tap on the Status key', async () => {
    const status = actionUuid('status');
    app.appear('k4', status, { column: 6, row: 0 });
    const opened = app.waitFor((m) => m.event === 'openUrl');
    app.key('keyDown', 'k4', status);
    app.key('keyUp', 'k4', status);
    const url = String(((await opened).payload as Json).url);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?t=[\w-]+#connection$/);

    // The link swaps its token for a session cookie, which gets the page.
    const login = await fetch(url, { redirect: 'manual' });
    expect(login.status).toBe(303);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const origin = new URL(url).origin;
    const page = await fetch(`${origin}/`, { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<script type="module" src="/app.js">');
    const script = await fetch(`${origin}/app.js`, { headers: { cookie } });
    expect(script.headers.get('content-type')).toMatch(/javascript/);
  });

  it('answers the Property Inspector and stores what it changes', async () => {
    const snapshot = actionUuid('snapshot');
    app.appear('k5', snapshot, { column: 0, row: 0 }, { n: 1 });
    await app.waitFor((m) => m.event === 'setImage' && m.context === 'k5');
    const view = (m: Json) => (m.payload as { view?: { summary?: string } }).view;
    const shown = app.waitFor((m) => m.event === 'sendToPropertyInspector' && m.context === 'k5');
    app.send({
      event: 'propertyInspectorDidAppear',
      action: snapshot,
      context: 'k5',
      device: XL.id,
    });
    expect(view(await shown)?.summary).toBe('Loads snapshot 1.');

    // A choice in the inspector: the plugin stores it and shows the new view.
    const stored = app.waitFor((m) => m.event === 'setSettings' && m.context === 'k5');
    const again = app.waitFor(
      (m) => m.event === 'sendToPropertyInspector' && view(m)?.summary === 'Loads snapshot 3.',
    );
    app.send({
      event: 'sendToPlugin',
      action: snapshot,
      context: 'k5',
      payload: { event: 'set', key: 'n', value: 3 },
    });
    expect((await stored).payload).toEqual({ n: 3 });
    await again;
    app.send({
      event: 'propertyInspectorDidDisappear',
      action: snapshot,
      context: 'k5',
      device: XL.id,
    });
  });

  it('shows the first Test Images page, and its PNG after a long press', async () => {
    const action = actionUuid('test-image');
    const first = DEBUG_PAGES[0]?.keys[0];
    if (!first) throw new Error('no test images');
    const svg = svgDataUrl(renderKey(first));
    const shown = app.waitFor(
      (m) => m.event === 'setImage' && m.context === 'k3' && (m.payload as Json).image === svg,
    );
    app.appear('k3', action, { column: 0, row: 0 });
    await shown;
    // The long press switches to PNG as soon as it is reached, before key up.
    const png = app.waitFor(
      (m) =>
        m.event === 'setImage' &&
        m.context === 'k3' &&
        String((m.payload as Json).image).startsWith('data:image/png;base64,'),
    );
    app.key('keyDown', 'k3', action);
    await new Promise((resolve) =>
      setTimeout(resolve, DEFAULT_SETTINGS.gestures.longPressMs + 100),
    );
    app.key('keyUp', 'k3', action);
    await png;
  });
});

async function until(test: () => boolean, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!test()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
