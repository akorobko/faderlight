// The committed manifest agrees with the action registry and the design rules.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIONS } from '@faderlight/deck';
import { PLUGIN_DIR } from '../scripts/paths.ts';
import { actionUuid, CONSOLE_PROFILE, kindOfAction, PLUGIN_UUID } from '../src/ids.ts';

interface ManifestAction {
  UUID: string;
  Name: string;
  Tooltip: string;
  Icon: string;
  States: { Image: string }[];
  Controllers: string[];
}

interface Manifest {
  UUID: string;
  Name: string;
  SDKVersion: number;
  Software: { MinimumVersion: string };
  OS: { Platform: string }[];
  Nodejs: { Version: string };
  CodePath: string;
  Icon: string;
  CategoryIcon: string;
  Actions: ManifestAction[];
  Profiles: { Name: string; DeviceType: number }[];
}

const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, 'manifest.json'), 'utf8')) as Manifest;

/** An image path in the manifest is written without its extension. */
const imageExists = (path: string, extensions: readonly string[]) =>
  extensions.some((ext) => existsSync(join(PLUGIN_DIR, `${path}${ext}`)));

describe('manifest.json', () => {
  it('targets SDK 3 on Stream Deck 7.1 or later, on macOS and Windows', () => {
    expect(manifest.UUID).toBe(PLUGIN_UUID);
    expect(manifest.SDKVersion).toBe(3);
    expect(manifest.Software.MinimumVersion).toBe('7.1');
    expect(manifest.Nodejs.Version).toBe('24');
    expect(manifest.OS.map((o) => o.Platform).sort()).toEqual(['mac', 'windows']);
    expect(manifest.CodePath).toBe('bin/plugin.js');
  });

  it('bundles the Console profile for the Stream Deck XL', () => {
    expect(manifest.Profiles).toEqual([expect.objectContaining({ Name: CONSOLE_PROFILE })]);
    // DeviceType 2: Stream Deck XL.
    expect(manifest.Profiles[0]?.DeviceType).toBe(2);
  });

  it('declares exactly the actions of the registry, in the same order', () => {
    expect(manifest.Actions.map((a) => a.UUID)).toEqual(ACTIONS.map((a) => actionUuid(a.kind)));
    for (const [i, info] of ACTIONS.entries()) {
      const action = manifest.Actions[i];
      expect(action?.Name).toBe(info.name);
      expect(action?.Tooltip).toBe(info.tooltip);
      expect(kindOfAction(action?.UUID ?? '')).toBe(info.kind);
      expect(action?.Controllers).toEqual(['Keypad']);
    }
  });

  it('has an image file for every icon', () => {
    expect(imageExists(manifest.Icon, ['.png'])).toBe(true);
    expect(imageExists(`${manifest.Icon}@2x`, ['.png'])).toBe(true);
    expect(imageExists(manifest.CategoryIcon, ['.svg', '.png'])).toBe(true);
    for (const action of manifest.Actions) {
      expect(imageExists(action.Icon, ['.svg', '.png']), action.Icon).toBe(true);
      for (const state of action.States)
        expect(imageExists(state.Image, ['.svg', '.png'])).toBe(true);
    }
  });

  it('keeps third-party names out of the plugin and action names and UUIDs', () => {
    const forbidden = /rme|totalmix|fireface|elgato|stream ?deck/i;
    for (const id of [
      manifest.UUID,
      manifest.Name,
      ...manifest.Actions.flatMap((a) => [a.UUID, a.Name]),
    ]) {
      expect(id).not.toMatch(forbidden);
    }
  });
});
