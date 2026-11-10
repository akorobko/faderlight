// Test Images, a debug action for reviewing the renderer on a real Stream Deck XL (plan M3.4):
// the pages of the contact sheet (renders/contact-sheet.png) key by key. First the three deck
// pages (Console, Inputs, Channel Detail), then every golden case, 32 to a page, in the order
// of the sheet. Each page is shown as SVG, as the plugin sends keys, or as the PNG the goldens
// renderer (resvg) draws from the same SVG; the build writes those PNGs into debug/.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DebugImages } from '@faderlight/deck';
import { renderKey, svgDataUrl, type KeyView } from '@faderlight/render';
// The cases and pages of the contact sheet live with the renderer's tests.
import { CASES } from '../../render/test/cases.ts';
import { CONSOLE_PAGES } from '../../render/test/pages.ts';

export const KEYS_PER_PAGE = 32;

export interface DebugPage {
  readonly title: string;
  readonly keys: readonly (KeyView | undefined)[];
}

export const DEBUG_PAGES: readonly DebugPage[] = [
  ...CONSOLE_PAGES.map((p) => ({ title: p.title, keys: p.keys })),
  ...Array.from({ length: Math.ceil(CASES.length / KEYS_PER_PAGE) }, (_, i) => ({
    title: `Golden cases ${String(i * KEYS_PER_PAGE + 1)}-${String(Math.min(CASES.length, (i + 1) * KEYS_PER_PAGE))}`,
    keys: CASES.slice(i * KEYS_PER_PAGE, (i + 1) * KEYS_PER_PAGE).map((c) => c.view),
  })),
];

/** File name of a key's PNG in the plugin's debug/ folder. */
export const pngName = (page: number, position: number): string =>
  `${String(page + 1).padStart(2, '0')}-${String(position).padStart(2, '0')}.png`;

/** The images for the runtime: SVG drawn now, PNG read from `dir` (the build wrote them). */
export function debugImages(dir: string): DebugImages {
  const png = new Map<string, string | undefined>();
  return {
    pages: DEBUG_PAGES.length,
    title: (page) => DEBUG_PAGES[page]?.title ?? '',
    image: (page, position, mode) => {
      const view = DEBUG_PAGES[page]?.keys[position];
      if (!view) return undefined;
      if (mode === 'svg') return svgDataUrl(renderKey(view));
      const name = pngName(page, position);
      if (!png.has(name)) {
        try {
          png.set(
            name,
            `data:image/png;base64,${readFileSync(join(dir, name)).toString('base64')}`,
          );
        } catch {
          png.set(name, undefined);
        }
      }
      return png.get(name);
    },
  };
}
