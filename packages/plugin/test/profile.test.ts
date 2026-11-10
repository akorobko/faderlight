// The bundled Console profile: a Console Slot on every key of an XL, the same bytes every build.

import { describe, expect, it } from 'vitest';
import { consoleProfileEntries, stableUuid, XL_MODEL } from '../scripts/profile.ts';
import { unzip, zip } from '../scripts/zip.ts';
import { actionUuid, PLUGIN_UUID } from '../src/ids.ts';

interface PageManifest {
  Controllers: {
    Type: string;
    Actions: Record<string, { UUID: string; Plugin: { UUID: string } }>;
  }[];
}

describe('the Console profile', () => {
  const entries = consoleProfileEntries('0.1.0.0');
  const files = new Map(
    entries.map((e) => [e.name, JSON.parse(Buffer.from(e.data).toString('utf8')) as unknown]),
  );

  it('is one XL page with a Console Slot on each of the 32 keys', () => {
    const [root, page] = [...files.keys()];
    expect(root).toMatch(/^[0-9A-F-]{36}\.sdProfile\/manifest\.json$/);
    expect(page).toMatch(/^[0-9A-F-]{36}\.sdProfile\/Profiles\/[0-9A-F-]{36}\/manifest\.json$/);
    expect(files.get(root ?? '')).toMatchObject({
      Device: { Model: XL_MODEL },
      Pages: { Pages: [expect.any(String)] },
    });
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

  it('is the same archive on every build, and reads back', () => {
    const a = zip(entries);
    expect(zip(consoleProfileEntries('0.1.0.0')).equals(a)).toBe(true);
    expect(unzip(a).map((e) => [e.name, Buffer.from(e.data).toString('utf8')])).toEqual(
      entries.map((e) => [e.name, Buffer.from(e.data).toString('utf8')]),
    );
  });

  it('derives UUIDs from names', () => {
    expect(stableUuid('x')).toBe(stableUuid('x'));
    expect(stableUuid('x')).not.toBe(stableUuid('y'));
    expect(stableUuid('x')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
