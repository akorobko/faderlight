// Builds the plugin into its .sdPlugin folder, ready for `streamdeck link` or `streamdeck pack`:
//
//   bin/plugin.js   src/plugin.ts and everything it imports, bundled with Rollup (one ES module)
//   fonts/          the renderer's fonts (packages/render/fonts), read at runtime
//
// The manifest and the icons are committed in the folder; everything above is generated and
// gitignored. With --out <dir> the build goes to another folder (tests use a temporary one) and
// the committed files are copied there too.
//
//   node packages/plugin/scripts/build.ts [--out <dir>]

import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import commonjsImport from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { rollup, type Plugin } from 'rollup';
import ts from 'typescript';
import { FONTS_DIR, PACKAGE_DIR, PLUGIN_DIR } from './paths.ts';

// The CommonJS plugin's types describe a CommonJS module, so TypeScript sees the module object
// where an ES import gets the function itself.
const commonjs = ((commonjsImport as unknown as { default?: unknown }).default ??
  commonjsImport) as unknown as typeof commonjsImport.default;

/** Generated parts of the plugin folder (gitignored). */
export const GENERATED = ['bin', 'fonts'] as const;

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

async function bundle(outDir: string): Promise<void> {
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
    await build.write({ file: join(outDir, 'bin/plugin.js'), format: 'es' });
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

export interface BuildOptions {
  /** Folder to build into (default: the plugin folder in the repo). */
  readonly outDir?: string;
}

/** Builds the plugin; returns the folder it built into. */
export async function buildPlugin(options: BuildOptions = {}): Promise<string> {
  const outDir = resolve(options.outDir ?? PLUGIN_DIR);
  if (outDir !== PLUGIN_DIR) {
    for (const item of STATIC)
      cpSync(join(PLUGIN_DIR, item), join(outDir, item), { recursive: true });
  }
  for (const item of GENERATED) rmSync(join(outDir, item), { recursive: true, force: true });
  await bundle(outDir);
  copyFonts(outDir);
  return outDir;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const dir = await buildPlugin(values.out === undefined ? {} : { outDir: values.out });
  console.log(`Built ${dir}`);
}
