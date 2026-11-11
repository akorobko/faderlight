// Builds the plugin into its .sdPlugin folder, ready for `streamdeck link` or `streamdeck pack`:
//
//   bin/plugin.js   src/plugin.ts and everything it imports, bundled with Rollup (one ES module)
//   control-center/ the Control Center page (packages/control-center/scripts/build-ui.ts)
//   pi/             the Property Inspector page (scripts/build-pi.ts)
//   fonts/          the renderer's fonts (packages/render/fonts), read at runtime
//   profiles/       the bundled profiles: Console and Render Test (scripts/profile.ts)
//   debug/          PNGs of the Test Images pages (src/debug.ts), drawn with resvg
//   LICENSE         the repository's licence
//   THIRD-PARTY-NOTICES.txt  the licences of the packages in the bundles (scripts/notices.ts)
//
// The manifest and the icons are committed in the folder; everything above is generated and
// gitignored. With --out <dir> the build goes to another folder (tests use a temporary one) and
// the committed files are copied there too. A release build (scripts/pack.ts) always goes to
// another folder: its manifest leaves out the debug aids (scripts/release.ts), so it has no
// Render Test profile and no debug/.
//
//   node packages/plugin/scripts/build.ts [--out <dir>]

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import commonjsImport from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { rollup, type Plugin } from 'rollup';
import ts from 'typescript';
import { renderKey } from '@faderlight/render';
import { writeUi } from '../../control-center/scripts/build-ui.ts';
import { initRaster, rasterize } from '../../render/test/raster.ts';
import { UI_FOLDER } from '../src/control-center.ts';
import { DEBUG_PAGES, pngName } from '../src/debug.ts';
import { PI_FOLDER, writePi } from './build-pi.ts';
import { NOTICES_FILE, thirdPartyNotices } from './notices.ts';
import { FONTS_DIR, PACKAGE_DIR, PLUGIN_DIR } from './paths.ts';
import { writeProfiles } from './profile.ts';
import { pluginVersion, releaseManifest } from './release.ts';

// The CommonJS plugin's types describe a CommonJS module, so TypeScript sees the module object
// where an ES import gets the function itself.
const commonjs = ((commonjsImport as unknown as { default?: unknown }).default ??
  commonjsImport) as unknown as typeof commonjsImport.default;

/** Generated parts of the plugin folder (gitignored). */
export const GENERATED = [
  'bin',
  UI_FOLDER,
  PI_FOLDER,
  'fonts',
  'profiles',
  'debug',
  'LICENSE',
  NOTICES_FILE,
] as const;

/** The repository's licence, copied into the plugin folder. */
const LICENSE = resolve(PACKAGE_DIR, '../../LICENSE');

/** Committed parts, copied when building into another folder. */
const STATIC = ['manifest.json', 'imgs'] as const;

/**
 * Turns the repo's erasable TypeScript into JavaScript, file by file. No type checking (`tsc`
 * does that in `npm run check`) and no module rewriting: Rollup resolves the `.ts` imports.
 */
function typescript(): Plugin {
  return {
    name: 'faderlight-typescript',
    transform(code, id) {
      if (!id.endsWith('.ts')) return null;
      const out = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          verbatimModuleSyntax: true,
          sourceMap: true,
        },
      });
      return { code: out.outputText, map: out.sourceMapText ?? null };
    },
  };
}

async function bundle(outDir: string, modules: Set<string>): Promise<void> {
  const build = await rollup({
    input: join(PACKAGE_DIR, 'src/plugin.ts'),
    plugins: [
      typescript(),
      nodeResolve({ exportConditions: ['node'], preferBuiltins: true }),
      commonjs({ ignoreDynamicRequires: true }),
    ],
    onwarn(warning, warn) {
      // The SDK's dependencies have circular imports and `this` at the top level of CommonJS
      // files; both are harmless in the bundle.
      if (warning.code === 'CIRCULAR_DEPENDENCY' || warning.code === 'THIS_IS_UNDEFINED') return;
      warn(warning);
    },
  });
  try {
    const { output } = await build.write({ file: join(outDir, 'bin/plugin.js'), format: 'es' });
    for (const chunk of output)
      if (chunk.type === 'chunk') chunk.moduleIds.forEach((id) => modules.add(id));
  } finally {
    await build.close();
  }
  // The .sdPlugin folder has no package.json of its own, so mark bin/ as ES modules.
  writeFileSync(join(outDir, 'bin/package.json'), '{ "type": "module" }\n');
}

function copyFonts(outDir: string): void {
  const dir = join(outDir, 'fonts');
  mkdirSync(dir, { recursive: true });
  for (const file of readdirSync(FONTS_DIR)) {
    if (file.endsWith('.ttf') || file === 'OFL.txt') cpSync(join(FONTS_DIR, file), join(dir, file));
  }
}

/** The PNGs of the Test Images pages, at the XL's high-resolution key size. */
async function writeDebugImages(outDir: string): Promise<void> {
  const dir = join(outDir, 'debug');
  mkdirSync(dir, { recursive: true });
  await initRaster();
  DEBUG_PAGES.forEach((page, p) => {
    page.keys.forEach((view, i) => {
      if (view)
        writeFileSync(join(dir, pngName(p, i)), rasterize(renderKey(view, undefined, 144)).png);
    });
  });
}

export interface BuildOptions {
  /** Folder to build into (default: the plugin folder in the repo). */
  readonly outDir?: string;
  /** Leave out the debug aids and write the release manifest (needs another `outDir`). */
  readonly release?: boolean;
}

/** Builds the plugin; returns the folder it built into. */
export async function buildPlugin(options: BuildOptions = {}): Promise<string> {
  const outDir = resolve(options.outDir ?? PLUGIN_DIR);
  const release = options.release === true;
  if (release && outDir === PLUGIN_DIR) {
    throw new Error('a release build goes to another folder, not the committed plugin folder');
  }
  if (outDir !== PLUGIN_DIR) {
    for (const item of STATIC)
      cpSync(join(PLUGIN_DIR, item), join(outDir, item), { recursive: true });
  }
  if (release) {
    const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, 'manifest.json'), 'utf8')) as {
      Version: string;
      Actions: { UUID: string }[];
    };
    const out = releaseManifest(manifest, pluginVersion());
    writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(out, null, 2)}\n`);
  }
  for (const item of GENERATED) rmSync(join(outDir, item), { recursive: true, force: true });
  const modules = new Set<string>();
  await bundle(outDir, modules);
  await writeUi(join(outDir, UI_FOLDER), modules);
  await writePi(join(outDir, PI_FOLDER), modules);
  cpSync(LICENSE, join(outDir, 'LICENSE'));
  writeFileSync(join(outDir, NOTICES_FILE), thirdPartyNotices(modules));
  copyFonts(outDir);
  writeProfiles(outDir);
  if (!release) await writeDebugImages(outDir);
  return outDir;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const dir = await buildPlugin(values.out === undefined ? {} : { outDir: values.out });
  console.log(`Built ${dir}`);
}
