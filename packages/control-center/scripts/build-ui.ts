// Builds the Control Center page: index.html, app.js (ui/main.tsx and everything it imports)
// and app.css. The plugin build writes them into the plugin's control-center/ folder; the
// virtual deck and the tests build them in memory.
//
//   node packages/control-center/scripts/build-ui.ts [--out <dir>]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { UiFile } from '../src/server.ts';
import { bundleBrowser } from './bundle.ts';

export const UI_DIR = join(import.meta.dirname, '../ui');

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>Faderlight Control Center</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <noscript>The Control Center needs JavaScript.</noscript>
    <script type="module" src="/app.js"></script>
  </body>
</html>
`;

/** The page's files by path, ready for ControlCenterServer. */
export async function buildUi(): Promise<Map<string, UiFile>> {
  const js = await bundleBrowser(join(UI_DIR, 'main.tsx'));
  return new Map<string, UiFile>([
    ['/index.html', { type: 'text/html; charset=utf-8', body: PAGE }],
    ['/app.js', { type: 'text/javascript; charset=utf-8', body: js }],
    [
      '/app.css',
      { type: 'text/css; charset=utf-8', body: readFileSync(join(UI_DIR, 'style.css'), 'utf8') },
    ],
  ]);
}

/** Writes the page's files into a folder (the plugin's control-center/). */
export async function writeUi(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  for (const [path, file] of await buildUi()) writeFileSync(join(dir, path.slice(1)), file.body);
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const out = resolve(values.out ?? 'control-center');
  await writeUi(out);
  console.log(`Built ${out}`);
}
