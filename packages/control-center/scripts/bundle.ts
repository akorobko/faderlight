// Bundles browser code (the Control Center page, the Property Inspector) into one script with
// Rollup. TypeScript and TSX (Preact's JSX) are transpiled file by file, without type checking
// (`npm run typecheck` does that) and without minifying: the page is served from this computer,
// and readable code is easier to debug in the browser.

import { nodeResolve } from '@rollup/plugin-node-resolve';
import { rollup, type Plugin } from 'rollup';
import ts from 'typescript';

/** Transpiles the repo's erasable TypeScript, and TSX with Preact's JSX runtime. */
export function typescript(): Plugin {
  return {
    name: 'faderlight-typescript',
    transform(code, id) {
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return null;
      const out = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          verbatimModuleSyntax: true,
          jsx: ts.JsxEmit.ReactJSX,
          jsxImportSource: 'preact',
          sourceMap: true,
        },
      });
      return { code: out.outputText, map: out.sourceMapText ?? null };
    },
  };
}

/** One browser script (an ES module) with everything `entry` imports. */
export async function bundleBrowser(entry: string): Promise<string> {
  const build = await rollup({
    input: entry,
    plugins: [
      typescript(),
      nodeResolve({
        browser: true,
        exportConditions: ['browser'],
        extensions: ['.ts', '.tsx', '.js'],
      }),
    ],
    onwarn(warning, warn) {
      // Type-only imports of server modules leave nothing behind.
      if (warning.code === 'EMPTY_BUNDLE') return;
      warn(warning);
    },
  });
  try {
    const { output } = await build.generate({ format: 'es' });
    const chunk = output.find((o) => o.type === 'chunk');
    if (!chunk || output.length !== 1) throw new Error(`expected one chunk from ${entry}`);
    // Anything that reached for Node would fail in the browser: catch it here.
    const node = chunk.imports.filter((i) => i.startsWith('node:') || !i.startsWith('.'));
    if (node.length > 0) throw new Error(`${entry} imports ${node.join(', ')}`);
    return chunk.code;
  } finally {
    await build.close();
  }
}
