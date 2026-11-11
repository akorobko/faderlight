// The licence notices of the third-party packages bundled into the plugin. Their licences (MIT
// and the like) ask that every copy keeps the copyright and licence text, and a bundle drops
// the packages' own files, so the build writes them into THIRD-PARTY-NOTICES.txt next to the
// manifest, along with the plugin's own LICENSE.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The file the build writes into the plugin folder. */
export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.txt';

const NODE_MODULES = '/node_modules/';

/**
 * The folder of the package a bundled module comes from, or undefined for the repository's own
 * code. Takes Rollup module ids: virtual ones start with "\0" and may end in "?query".
 */
export function packageRoot(moduleId: string): string | undefined {
  const id = moduleId.replace(/^\0/, '').replace(/\?.*$/, '');
  const at = id.replaceAll('\\', '/').lastIndexOf(NODE_MODULES);
  if (at < 0) return undefined;
  const start = at + NODE_MODULES.length;
  const parts = id.slice(start).split(/[\\/]/);
  const name = parts[0]?.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1);
  if (name.length === 0 || name.some((p) => p === '')) return undefined;
  return id.slice(0, start) + name.join(id.includes('\\') ? '\\' : '/');
}

interface PackageInfo {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly text: string | undefined;
}

function readPackage(root: string): PackageInfo {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    license?: string;
  };
  const file = readdirSync(root).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
  return {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license ?? 'no licence named',
    text: file === undefined ? undefined : readFileSync(join(root, file), 'utf8').trim(),
  };
}

/** THIRD-PARTY-NOTICES.txt for the bundled modules, one section per package, by name. */
export function thirdPartyNotices(moduleIds: Iterable<string>): string {
  const roots = new Set<string>();
  for (const id of moduleIds) {
    const root = packageRoot(id);
    if (root !== undefined && existsSync(join(root, 'package.json'))) roots.add(root);
  }
  const packages = [...roots]
    .map(readPackage)
    .filter((p) => !p.name.startsWith('@faderlight/'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rule = '='.repeat(80);
  const sections = packages.map((p) =>
    [
      rule,
      `${p.name} ${p.version} (${p.license})`,
      rule,
      '',
      p.text ?? `The package has no licence file; its package.json names ${p.license}.`,
    ].join('\n'),
  );
  return [
    'Faderlight bundles the following third-party packages. Each one is followed by its',
    "licence text. Faderlight's own licence is in LICENSE, and the fonts' in fonts/OFL.txt.",
    '',
    ...sections.map((s) => `${s}\n`),
  ].join('\n');
}
