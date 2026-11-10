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
import { actionUuid, PLUGIN_UUID } from '../src/ids.ts';
import { FakeStreamDeck, type Json } from './fake-app.ts';

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
});
