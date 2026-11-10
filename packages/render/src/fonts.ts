// The fonts keys are drawn with: Fira Sans Condensed (SIL Open Font License 1.1, see
// packages/render/fonts/OFL.txt), SemiBold for labels and names, Bold for values. Condensed
// letters fit channel names on a 96 px key; the font covers Latin, Greek and Cyrillic.
//
// In Node the files are read from packages/render/fonts/ on first use. Elsewhere (a browser,
// or a bundle that moves the files) hand the bytes to useFonts() before rendering.

import { parseFont, type Font } from './font.ts';

export type FaceName = 'semibold' | 'bold';

export type Faces = Readonly<Record<FaceName, Font>>;

const FILES: Readonly<Record<FaceName, string>> = {
  semibold: 'FiraSansCondensed-SemiBold.ttf',
  bold: 'FiraSansCondensed-Bold.ttf',
};

let faces: Faces | undefined;

/** Uses these font files instead of the bundled ones (e.g. in a browser). */
export function useFonts(files: Readonly<Record<FaceName, Uint8Array>>): void {
  faces = { semibold: parseFont(files.semibold), bold: parseFont(files.bold) };
}

/** The faces keys are drawn with, loading the bundled files on first use. */
export function fonts(): Faces {
  faces ??= loadBundled();
  return faces;
}

export function face(name: FaceName): Font {
  return fonts()[name];
}

function loadBundled(): Faces {
  // getBuiltinModule instead of an import keeps this module loadable where node:fs is absent.
  const fs =
    typeof process === 'undefined'
      ? undefined
      : (process.getBuiltinModule('node:fs') as typeof import('node:fs') | undefined);
  if (!fs) throw new Error('No font files: call useFonts() before rendering outside Node.');
  const read = (file: string) => fs.readFileSync(new URL(`../fonts/${file}`, import.meta.url));
  return { semibold: parseFont(read(FILES.semibold)), bold: parseFont(read(FILES.bold)) };
}
