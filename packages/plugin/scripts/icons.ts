// Writes the plugin's icons into the .sdPlugin folder's imgs/: SVG action icons for the
// action list (20 x 20, white on transparent), the default key image (72 x 72), the category
// icon (28 x 28) and the plugin icon as PNG (256 and 512 px, the app wants PNG there).
//
// All artwork is our own: simple faders, speakers and arrows, no third-party marks. The output
// is committed; run `node packages/plugin/scripts/icons.ts` after changing a drawing here.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActionKind } from '@faderlight/deck';
import { initRaster, rasterize } from '../../render/test/raster.ts';
import { PLUGIN_DIR } from './paths.ts';

const W = '#ffffff';

const svg = (size: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}">${body}</svg>\n`;

const fader = `<rect x="9" y="2" width="2" height="16" rx="1" fill="${W}"/><rect x="5" y="8" width="10" height="4" rx="1.5" fill="${W}"/>`;
const speaker = `<path d="M3 7.5h3.5L11 3.5v13l-4.5-4H3z" fill="${W}"/>`;

/** Action list icons, 20 x 20. */
const ACTION_ICONS: Readonly<Record<ActionKind, string>> = {
  slot: `<rect x="2" y="4" width="7" height="5" rx="1" fill="${W}"/><rect x="11" y="4" width="7" height="5" rx="1" fill="none" stroke="${W}" stroke-width="1.5"/><rect x="2" y="11" width="7" height="5" rx="1" fill="none" stroke="${W}" stroke-width="1.5"/><rect x="11" y="11" width="7" height="5" rx="1" fill="none" stroke="${W}" stroke-width="1.5"/>`,
  channel: fader,
  output: `${speaker}<path d="M13.5 7a4 4 0 0 1 0 6M15.5 5a7 7 0 0 1 0 10" fill="none" stroke="${W}" stroke-width="1.5" stroke-linecap="round"/>`,
  phones: `<path d="M4 13V10a6 6 0 0 1 12 0v3" fill="none" stroke="${W}" stroke-width="1.8"/><rect x="2.5" y="11" width="4" height="6" rx="1.5" fill="${W}"/><rect x="13.5" y="11" width="4" height="6" rx="1.5" fill="${W}"/>`,
  snapshot: `<rect x="2.5" y="5" width="15" height="11" rx="2" fill="none" stroke="${W}" stroke-width="1.6"/><circle cx="10" cy="10.5" r="3" fill="${W}"/><rect x="6" y="3" width="5" height="2.5" rx="1" fill="${W}"/>`,
  monitor: `${speaker}<rect x="13" y="9.2" width="5" height="1.6" rx="0.8" fill="${W}"/>`,
  global: `<circle cx="10" cy="10" r="7" fill="none" stroke="${W}" stroke-width="1.6"/><path d="M5.2 14.8 14.8 5.2" stroke="${W}" stroke-width="1.6"/>`,
  status: `<circle cx="10" cy="13" r="2.2" fill="${W}"/><path d="M6 9.5a5.5 5.5 0 0 1 8 0M3.5 7a9 9 0 0 1 13 0" fill="none" stroke="${W}" stroke-width="1.6" stroke-linecap="round"/>`,
  step: `<path d="M10 2.5 15 8H5z" fill="${W}"/><path d="M10 17.5 5 12h10z" fill="${W}"/>`,
  console: `<rect x="2" y="3" width="16" height="14" rx="2" fill="none" stroke="${W}" stroke-width="1.5"/><rect x="5" y="6" width="2" height="8" fill="${W}"/><rect x="9" y="6" width="2" height="8" fill="${W}"/><rect x="13" y="6" width="2" height="8" fill="${W}"/>`,
  preset: `${fader}<path d="M14 2.5h4.5v6l-2.25-1.6L14 8.5z" fill="${W}"/>`,
  exit: `<path d="M11 3H4.5A1.5 1.5 0 0 0 3 4.5v11A1.5 1.5 0 0 0 4.5 17H11" fill="none" stroke="${W}" stroke-width="1.6"/><path d="M8 10h9M13.5 6.5 17 10l-3.5 3.5" fill="none" stroke="${W}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  'test-image': `<rect x="2.5" y="2.5" width="15" height="15" rx="1.5" fill="none" stroke="${W}" stroke-width="1.5"/><rect x="5" y="5" width="5" height="5" fill="${W}"/><rect x="10" y="10" width="5" height="5" fill="${W}"/>`,
};

/** Key image shown until the plugin draws the key. */
const KEY = `<rect width="72" height="72" fill="#101317"/><rect x="34" y="14" width="4" height="44" rx="2" fill="#3a414b"/><rect x="24" y="30" width="24" height="10" rx="3" fill="#d9dee5"/>`;

/** The plugin icon on a 256 canvas: three faders and a meter. */
function pluginIcon(size: number): string {
  const s = size / 256;
  const r = (x: number, y: number, w: number, h: number, rx: number, fill: string) =>
    `<rect x="${String(x * s)}" y="${String(y * s)}" width="${String(w * s)}" height="${String(h * s)}" rx="${String(rx * s)}" fill="${fill}"/>`;
  return svg(
    size,
    r(0, 0, 256, 256, 48, '#121519') +
      [56, 112, 168]
        .map(
          (x, i) =>
            r(x - 5, 52, 10, 152, 5, '#343b45') +
            r(x - 26, [118, 78, 140][i] ?? 118, 52, 26, 8, i === 1 ? '#35c7c0' : '#e3e7ec'),
        )
        .join('') +
      r(208, 52, 16, 152, 4, '#1f252c') +
      r(208, 124, 16, 80, 4, '#3fbf62') +
      r(208, 100, 16, 22, 4, '#e3c23a'),
  );
}

const CATEGORY = `<rect x="6" y="3" width="3" height="22" rx="1.5" fill="${W}"/><rect x="2" y="15" width="11" height="5" rx="1.5" fill="${W}"/><rect x="19" y="3" width="3" height="22" rx="1.5" fill="${W}"/><rect x="15" y="7" width="11" height="5" rx="1.5" fill="${W}"/>`;

export async function writeIcons(dir = PLUGIN_DIR): Promise<void> {
  const imgs = join(dir, 'imgs');
  for (const sub of ['actions', 'keys', 'plugin']) mkdirSync(join(imgs, sub), { recursive: true });
  for (const [kind, body] of Object.entries(ACTION_ICONS)) {
    writeFileSync(join(imgs, 'actions', `${kind}.svg`), svg(20, body));
  }
  writeFileSync(join(imgs, 'keys', 'key.svg'), svg(72, KEY));
  writeFileSync(join(imgs, 'plugin', 'category.svg'), svg(28, CATEGORY));
  await initRaster();
  writeFileSync(join(imgs, 'plugin', 'icon.svg'), pluginIcon(256));
  writeFileSync(join(imgs, 'plugin', 'icon.png'), rasterize(pluginIcon(256)).png);
  writeFileSync(join(imgs, 'plugin', 'icon@2x.png'), rasterize(pluginIcon(512)).png);
}

if (import.meta.main) await writeIcons();
