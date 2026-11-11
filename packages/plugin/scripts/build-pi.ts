// Builds the Property Inspector page (pi/): index.html, pi.js (pi/main.ts, a classic script,
// since the Stream Deck app loads the page from a file) and pi.css. The plugin build writes
// them into the plugin's pi/ folder; the virtual deck builds them in memory.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleBrowser } from '../../control-center/scripts/bundle.ts';

export const PI_DIR = join(import.meta.dirname, '../pi');

/** The plugin folder's Property Inspector, as the manifest names it. */
export const PI_FOLDER = 'pi';

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="dark" />
    <title>Faderlight</title>
    <link rel="stylesheet" href="pi.css" />
  </head>
  <body>
    <main id="pi"></main>
    <script src="pi.js"></script>
  </body>
</html>
`;

/** The page's files by name; the ids of the bundled modules go to `modules`. */
export async function buildPi(modules?: Set<string>): Promise<Map<string, string>> {
  return new Map([
    ['index.html', PAGE],
    ['pi.js', await bundleBrowser(join(PI_DIR, 'main.ts'), 'iife', modules)],
    ['pi.css', readFileSync(join(PI_DIR, 'style.css'), 'utf8')],
  ]);
}

export async function writePi(dir: string, modules?: Set<string>): Promise<void> {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of await buildPi(modules)) writeFileSync(join(dir, name), body);
}
