// The release package: what the release manifest leaves out, the version, and the packed file.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PLUGIN_DIR } from '../scripts/paths.ts';
import { pack } from '../scripts/pack.ts';
import {
  manifestVersion,
  packageName,
  pluginVersion,
  releaseManifest,
  releaseNotes,
} from '../scripts/release.ts';
import { unzip } from '../scripts/zip.ts';
import { actionUuid, CONSOLE_PROFILE, PLUGIN_UUID, RENDER_TEST_PROFILE } from '../src/ids.ts';

const committed = JSON.parse(readFileSync(join(PLUGIN_DIR, 'manifest.json'), 'utf8')) as {
  Version: string;
  Nodejs: Record<string, unknown>;
  Actions: { UUID: string }[];
  Profiles: { Name: string }[];
};

describe('the release manifest', () => {
  const out = releaseManifest(committed, '1.2.3');

  it('drops the Test Images action, the Render Test profile and the debugger port', () => {
    expect(out.Actions.map((a) => a.UUID)).not.toContain(actionUuid('test-image'));
    expect(out.Actions).toHaveLength(committed.Actions.length - 1);
    expect(out.Profiles?.map((p) => p.Name)).toEqual([CONSOLE_PROFILE]);
    expect(out.Nodejs).not.toHaveProperty('Debug');
    expect(out.Nodejs).toHaveProperty('Version', '24');
  });

  it('carries the four-part version and leaves its input alone', () => {
    expect(out.Version).toBe('1.2.3.0');
    expect(committed.Profiles.map((p) => p.Name)).toContain(RENDER_TEST_PROFILE);
    expect(committed.Nodejs).toHaveProperty('Debug');
  });

  it('refuses versions the Stream Deck app cannot compare', () => {
    expect(() => manifestVersion('0.2.0-beta.1')).toThrow(/MAJOR.MINOR.PATCH/);
    expect(() => manifestVersion('1.0')).toThrow();
  });

  it("matches the committed manifest's version to the package's", () => {
    expect(committed.Version).toBe(manifestVersion(pluginVersion()));
  });
});

describe('releaseNotes', () => {
  const changelog = [
    '# Changelog',
    '',
    '## 0.2.0',
    '',
    '- Second.',
    '',
    '## 0.1.0 - first release',
    '',
    '- First.',
    '- Also first.',
    '',
  ].join('\n');

  it('takes the section of one version, without its heading', () => {
    expect(releaseNotes(changelog, '0.2.0')).toBe('- Second.');
    expect(releaseNotes(changelog, '0.1.0')).toBe('- First.\n- Also first.');
  });

  it('finds no section for another version, nor for a prefix of one', () => {
    expect(releaseNotes(changelog, '0.3.0')).toBeUndefined();
    expect(releaseNotes(changelog, '0.1')).toBeUndefined();
  });

  it("has a section for the package's version in the repository's CHANGELOG.md", () => {
    const text = readFileSync(join(PLUGIN_DIR, '../../../CHANGELOG.md'), 'utf8');
    expect(releaseNotes(text, pluginVersion())).toBeTruthy();
  });
});

describe('pack', () => {
  const dist = mkdtempSync(join(tmpdir(), 'faderlight-pack-'));
  afterAll(() => {
    rmSync(dist, { recursive: true, force: true });
  });

  it('writes one .streamDeckPlugin with the release build and no debug aids', async () => {
    const out = await pack(dist);
    expect(out.file).toBe(join(dist, packageName(pluginVersion())));
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);

    const entries = unzip(readFileSync(out.file));
    const names = entries.map((e) => e.name);
    const root = `${PLUGIN_UUID}.sdPlugin/`;
    for (const file of [
      'manifest.json',
      'bin/plugin.js',
      'pi/index.html',
      'control-center/index.html',
      'fonts/OFL.txt',
      'LICENSE',
      'THIRD-PARTY-NOTICES.txt',
      `${CONSOLE_PROFILE}.streamDeckProfile`,
      'imgs/plugin/icon.png',
    ]) {
      expect(names, file).toContain(root + file);
    }
    expect(names.filter((n) => n.startsWith(`${root}debug/`))).toEqual([]);
    expect(names).not.toContain(`${root}${RENDER_TEST_PROFILE}.streamDeckProfile`);
    expect(names.filter((n) => n.startsWith(`${root}logs/`))).toEqual([]);

    const manifest = entries.find((e) => e.name === `${root}manifest.json`);
    const parsed = JSON.parse(Buffer.from(manifest?.data ?? []).toString('utf8')) as {
      Version: string;
      Nodejs: Record<string, unknown>;
    };
    expect(parsed.Version).toBe(manifestVersion(pluginVersion()));
    expect(parsed.Nodejs).not.toHaveProperty('Debug');

    // The bundles hold the SDK, ws and Preact, whose MIT licences ask to keep their notices.
    const notices = entries.find((e) => e.name === `${root}THIRD-PARTY-NOTICES.txt`);
    const text = Buffer.from(notices?.data ?? []).toString('utf8');
    for (const name of ['@elgato/streamdeck', 'preact', 'ws']) {
      expect(text, name).toMatch(new RegExp(`^${name} \\d+\\.\\d+\\.\\d+ \\(MIT\\)$`, 'm'));
    }
  }, 120_000);
});
