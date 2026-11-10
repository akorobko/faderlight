// The bundled Console profile: a Console Slot on every key of an XL, the same bytes every build.

import { describe, expect, it } from 'vitest';
import { pageFolder, PROFILES, profileEntries, stableUuid, XL_MODEL } from '../scripts/profile.ts';
import { unzip, zip } from '../scripts/zip.ts';
import { actionUuid, PLUGIN_UUID } from '../src/ids.ts';

interface PageManifest {
  Controllers: {
    Type: string;
    Actions: Record<string, { UUID: string; Plugin: { UUID: string } }>;
  }[];
}

const consoleProfile = PROFILES.find((p) => p.kind === 'slot') ?? {
  file: 'missing',
  name: 'missing',
  kind: 'slot',
};

describe('the bundled profiles', () => {
  const entries = profileEntries(consoleProfile, '0.1.0.0');
  const files = new Map(
    entries.map((e) => [e.name, JSON.parse(Buffer.from(e.data).toString('utf8')) as unknown]),
  );

  it('is one XL page with a Console Slot on each of the 32 keys', () => {
    const [root, page] = [...files.keys()];
    expect(root).toMatch(/^[0-9A-F-]{36}\.sdProfile\/manifest\.json$/);
    const manifest = files.get(root ?? '') as {
      Pages: { Current: string; Default: string; Pages: string[] };
      Version: string;
    };
    expect(manifest).toMatchObject({ Device: { Model: XL_MODEL }, Version: '2.0' });
    expect(manifest.Pages.Pages).toEqual([manifest.Pages.Current]);
    // The page lives in the folder named by its encoded ID, as in the app's own 2.0 bundles.
    expect(page).toBe(
      `${(root ?? '').split('/')[0] ?? ''}/Profiles/${pageFolder(manifest.Pages.Current)}/manifest.json`,
    );
    const actions = (files.get(page ?? '') as PageManifest).Controllers[0]?.Actions ?? {};
    const keys = Object.keys(actions);
    expect(keys).toHaveLength(32);
    expect(keys).toContain('7,3');
    expect(keys).not.toContain('3,7');
    for (const action of Object.values(actions)) {
      expect(action.UUID).toBe(actionUuid('slot'));
      expect(action.Plugin.UUID).toBe(PLUGIN_UUID);
    }
  });

  it('has an empty default page that the page list leaves out, as the app writes it', () => {
    const [root, , empty] = [...files.keys()];
    const manifest = files.get(root ?? '') as { Pages: { Default: string; Pages: string[] } };
    expect(manifest.Pages.Pages).not.toContain(manifest.Pages.Default);
    expect(empty).toBe(
      `${(root ?? '').split('/')[0] ?? ''}/Profiles/${pageFolder(manifest.Pages.Default)}/manifest.json`,
    );
    expect(files.get(empty ?? '')).toEqual({
      Controllers: [{ Actions: {}, Type: 'Keypad' }],
      Icon: '',
      Name: '',
    });
  });

  it('names page folders like the app: base32hex without U, then Z', () => {
    // Page IDs from bundles the app ships or imports, and the folders it keeps them in.
    expect(pageFolder('44bbdee2-49c7-4fa1-9946-d47f3bd6e582')).toBe('8ITTTOI9OT7Q36A6QHWJNLN5G8Z');
    expect(pageFolder('4501671e-39a0-4771-bcfc-efb7bbf72204')).toBe('8K0ME7HPK13N3F7STVRRNTP20GZ');
    expect(pageFolder('61d1eb3b-6084-425d-8886-8cf121c1b061')).toBe('C78VMER0GH15R246HJOI3GDGC4Z');
    expect(pageFolder('F5BAC9C2-470D-53FB-9A68-99BC95DE96D5')).toBe('VMTCJGI71L9WN6J8J6V9BNKMQKZ');
  });

  it('is the same archive on every build, and reads back', () => {
    const a = zip(entries);
    expect(zip(profileEntries(consoleProfile, '0.1.0.0')).equals(a)).toBe(true);
    expect(unzip(a).map((e) => [e.name, Buffer.from(e.data).toString('utf8')])).toEqual(
      entries.map((e) => [e.name, Buffer.from(e.data).toString('utf8')]),
    );
  });

  it('has Test Images on every key of the Render Test profile, with its own UUIDs', () => {
    const test = PROFILES.find((p) => p.kind === 'test-image');
    expect(test).toBeDefined();
    if (!test) return;
    const other = profileEntries(test, '0.1.0.0');
    const page = JSON.parse(Buffer.from(other[1]?.data ?? []).toString('utf8')) as PageManifest;
    const actions = Object.values(page.Controllers[0]?.Actions ?? {});
    expect(actions).toHaveLength(32);
    for (const a of actions) expect(a.UUID).toBe(actionUuid('test-image'));
    expect(other[0]?.name).not.toBe(entries[0]?.name);
  });

  it('derives UUIDs from names', () => {
    expect(stableUuid('x')).toBe(stableUuid('x'));
    expect(stableUuid('x')).not.toBe(stableUuid('y'));
    expect(stableUuid('x')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
