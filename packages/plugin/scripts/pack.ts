// Packs the plugin for release: a release build (scripts/build.ts with `release`, see
// scripts/release.ts) into dist/release/, validated and packed with `streamdeck pack` into dist/Faderlight-<version>.streamDeckPlugin, the one file users
// download for macOS and Windows. The version is packages/plugin/package.json's.
//
//   npm run plugin:pack                      # from the repository root
//   npm run plugin:pack -- --expect 0.1.0    # fails unless the version is 0.1.0 (release tags)

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PLUGIN_UUID } from '../src/ids.ts';
import { buildPlugin } from './build.ts';
import { PACKAGE_DIR } from './paths.ts';
import { packageName, pluginVersion, releaseNotes } from './release.ts';

/** dist/ at the repository root (gitignored). */
export const DIST_DIR = resolve(PACKAGE_DIR, '../../dist');

const CHANGELOG = resolve(PACKAGE_DIR, '../../CHANGELOG.md');

/**
 * Runs the Elgato CLI from node_modules, without its update check (CI may be offline), and
 * returns what it printed. A failure throws with that output in the message.
 */
function streamdeck(...args: string[]): string {
  const cli = createRequire(import.meta.url).resolve('@elgato/cli/bin/streamdeck.mjs');
  try {
    return execFileSync(process.execPath, [cli, ...args, '--no-update-check'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    throw new Error(`streamdeck ${args[0] ?? ''} failed:\n${e.stdout ?? ''}${e.stderr ?? ''}`, {
      cause: error,
    });
  }
}

export interface PackResult {
  readonly file: string;
  readonly version: string;
  readonly sha256: string;
  readonly bytes: number;
  /** What `streamdeck pack` printed. */
  readonly log: string;
}

export async function pack(distDir = DIST_DIR): Promise<PackResult> {
  const version = pluginVersion();
  const stage = join(distDir, 'release');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  const pluginDir = await buildPlugin({
    outDir: join(stage, `${PLUGIN_UUID}.sdPlugin`),
    release: true,
  });
  // `pack` validates the folder first and stops on any error.
  const log = streamdeck('pack', pluginDir, '--output', stage, '--force', '--no-file-list');

  const file = join(distDir, packageName(version));
  renameSync(join(stage, `${PLUGIN_UUID}.streamDeckPlugin`), file);
  const data = readFileSync(file);
  return {
    file,
    version,
    sha256: createHash('sha256').update(data).digest('hex'),
    bytes: data.length,
    log,
  };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { expect: { type: 'string' } } });
  const version = pluginVersion();
  const notes = existsSync(CHANGELOG)
    ? releaseNotes(readFileSync(CHANGELOG, 'utf8'), version)
    : undefined;
  if (values.expect !== undefined) {
    // A release tag: the tag, the package and the changelog must agree.
    if (values.expect.replace(/^v/, '') !== version) {
      console.error(
        `The tag is ${values.expect} but packages/plugin/package.json says ${version}.`,
      );
      process.exit(1);
    }
    if (!notes) {
      console.error(`CHANGELOG.md has no "## ${version}" section for the release notes.`);
      process.exit(1);
    }
  }
  const out = await pack();
  console.log(out.log.trim());
  console.log(`Packed ${out.file}`);
  console.log(`  version ${out.version}, ${(out.bytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  sha256  ${out.sha256}`);
  if (notes) {
    const file = resolve(DIST_DIR, 'release-notes.md');
    writeFileSync(file, `${notes}\n`);
    console.log(`Release notes in ${file}`);
  }
}
