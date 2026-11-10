// Writes the bundled profiles, each one page for a Stream Deck XL with the same action on all
// 32 keys: Console (a Console Slot on each key; the slots get their meaning from the deck
// runtime's layout, by coordinates, so the profile never changes when the layout does) and
// Render Test (Test Images on each key, for reviewing the renderer on the XL).
//
// The .streamDeckProfile format is not documented. This follows exported profiles: a ZIP with
// `<profile>.sdProfile/manifest.json` (device model, page list) and one
// `Profiles/<page>/manifest.json` per page whose Keypad controller maps "column,row" to actions.
// The maintainer checks it on the real XL (see the PR's hardware questions); if the app refuses
// it, a profile built in the app (a Console Slot on every key) and exported works the same.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ACTIONS, type ActionKind } from '@faderlight/deck';
import { CONSOLE_PROFILE, PLUGIN_UUID, RENDER_TEST_PROFILE, actionUuid } from '../src/ids.ts';
import { PLUGIN_DIR } from './paths.ts';
import { zip, type ZipEntry } from './zip.ts';

/** Stream Deck XL, as the app writes it in profiles (DeviceType 2 in the plugin manifest). */
export const XL_MODEL = '20GAT9901';
export const XL_COLUMNS = 8;
export const XL_ROWS = 4;

/** A UUID derived from a name, so the profile is the same on every build. */
export function stableUuid(name: string): string {
  const h = createHash('sha1').update(`${PLUGIN_UUID}/${name}`).digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50; // version 5 (name-based, SHA-1)
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export interface BundledProfile {
  /** Path in the plugin folder without the extension, as the manifest names it. */
  readonly file: string;
  /** Name the app shows. */
  readonly name: string;
  /** The action on every key. */
  readonly kind: ActionKind;
}

export const PROFILES: readonly BundledProfile[] = [
  { file: CONSOLE_PROFILE, name: 'Faderlight Console', kind: 'slot' },
  { file: RENDER_TEST_PROFILE, name: 'Faderlight Render Test', kind: 'test-image' },
];

function action(
  p: BundledProfile,
  column: number,
  row: number,
  version: string,
): Record<string, unknown> {
  return {
    ActionID: stableUuid(`${p.file}/key/${String(column)},${String(row)}`),
    LinkedTitle: true,
    Name: ACTIONS.find((a) => a.kind === p.kind)?.name ?? p.kind,
    Plugin: { Name: 'Faderlight', UUID: PLUGIN_UUID, Version: version },
    Resources: null,
    Settings: {},
    State: 0,
    States: [
      {
        FontFamily: '',
        FontSize: 12,
        FontStyle: '',
        FontUnderline: false,
        Image: '',
        OutlineThickness: 2,
        ShowTitle: false,
        Title: '',
        TitleAlignment: '',
        TitleColor: '#ffffff',
      },
    ],
    UUID: actionUuid(p.kind),
  };
}

const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

/** The files inside a profile archive. */
export function profileEntries(p: BundledProfile, version: string): ZipEntry[] {
  const profile = stableUuid(`${p.file}/profile`).toUpperCase();
  const page = stableUuid(`${p.file}/page/1`);
  const actions: Record<string, unknown> = {};
  for (let row = 0; row < XL_ROWS; row++) {
    for (let column = 0; column < XL_COLUMNS; column++) {
      actions[`${String(column)},${String(row)}`] = action(p, column, row, version);
    }
  }
  const root = `${profile}.sdProfile`;
  return [
    {
      name: `${root}/manifest.json`,
      data: json({
        Device: { Model: XL_MODEL, UUID: '' },
        Name: p.name,
        Pages: { Current: page, Default: page, Pages: [page] },
        Version: '2.0',
      }),
    },
    {
      name: `${root}/Profiles/${page.toUpperCase()}/manifest.json`,
      data: json({ Controllers: [{ Actions: actions, Type: 'Keypad' }], Icon: '', Name: '' }),
    },
  ];
}

/** Writes the bundled profiles into a plugin folder; returns their paths. */
export function writeProfiles(pluginDir = PLUGIN_DIR): string[] {
  const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, 'manifest.json'), 'utf8')) as {
    Version: string;
  };
  return PROFILES.map((p) => {
    const file = join(pluginDir, `${p.file}.streamDeckProfile`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, zip(profileEntries(p, manifest.Version)));
    return file;
  });
}
