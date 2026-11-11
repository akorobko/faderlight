// What a release build leaves out of the plugin folder, and its version.
//
// The development build (scripts/build.ts) carries debug aids: the Test Images action, the
// Render Test profile that puts it on every key, their PNGs in debug/, and a debugger port
// (`Nodejs.Debug`). A release has none of them: users would see an action they cannot use, and
// an open debugger port lets any program on the computer run code inside the plugin.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActionKind } from '@faderlight/deck';
import { actionUuid, RENDER_TEST_PROFILE } from '../src/ids.ts';
import { PACKAGE_DIR } from './paths.ts';

/** Actions only the development build declares. */
export const DEBUG_ACTIONS: readonly ActionKind[] = ['test-image'];

/** Bundled profiles only the development build carries (as the manifest names them). */
export const DEBUG_PROFILES: readonly string[] = [RENDER_TEST_PROFILE];

/** The plugin's version: the `version` of packages/plugin/package.json, e.g. "0.1.0". */
export function pluginVersion(): string {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

/**
 * The manifest's four-part version for a semver release: "0.1.0" -> "0.1.0.0". Pre-release
 * and build suffixes are refused, because the Stream Deck app compares plain numbers.
 */
export function manifestVersion(version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`version "${version}" is not MAJOR.MINOR.PATCH`);
  }
  return `${version}.0`;
}

interface Manifest {
  Version: string;
  Nodejs?: Record<string, unknown>;
  Actions: { UUID: string }[];
  Profiles?: { Name: string }[];
  [key: string]: unknown;
}

/** The development manifest turned into the release one; the input is not changed. */
export function releaseManifest(manifest: Manifest, version: string): Manifest {
  const debugUuids = new Set(DEBUG_ACTIONS.map(actionUuid));
  const nodejs = { ...manifest.Nodejs };
  delete nodejs.Debug;
  return {
    ...manifest,
    Version: manifestVersion(version),
    Nodejs: nodejs,
    Actions: manifest.Actions.filter((a) => !debugUuids.has(a.UUID)),
    ...(manifest.Profiles && {
      Profiles: manifest.Profiles.filter((p) => !DEBUG_PROFILES.includes(p.Name)),
    }),
  };
}

/** The file name users download, e.g. "Faderlight-0.1.0.streamDeckPlugin". */
export const packageName = (version: string): string => `Faderlight-${version}.streamDeckPlugin`;

/**
 * The section of CHANGELOG.md for a version: the lines under its "## <version>" heading, up to
 * the next "## " heading. Undefined when the changelog has no such section.
 */
export function releaseNotes(changelog: string, version: string): string | undefined {
  const lines = changelog.split(/\r?\n/);
  const heading = new RegExp(`^## ${version.replace(/\./g, '\\.')}(\\s|$)`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}
