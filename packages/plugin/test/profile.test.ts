// The bundled Console profile: a Console Slot on every key of an XL, the same bytes every build.

import { describe, expect, it } from 'vitest';
import { PROFILES, profileEntries, stableUuid, XL_MODEL } from '../scripts/profile.ts';
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
