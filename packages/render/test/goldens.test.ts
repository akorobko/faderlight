// Every case renders like its golden image, at every size, and the contact sheet is current.
// A mismatch writes the new render to renders/failures/ for a look; if the change is
// intended, run `npm run render:goldens` and commit the new images.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CASES, SIZES } from './cases.ts';
import {
  caseSvg,
  CONTACT_SHEET,
  FAILURE_DIR,
  GOLDEN_DIR,
  goldenFile,
  sheetSvg,
} from './goldens.ts';
import { decodePng, diffImages, initRaster, matches, rasterize, type Diff } from './raster.ts';

beforeAll(initRaster);

function compare(svg: string, goldenPath: string, failureName: string): Diff {
  const actual = rasterize(svg);
  const golden = decodePng(readFileSync(goldenPath));
  const diff = diffImages(actual, golden);
  if (!matches(diff)) {
    mkdirSync(FAILURE_DIR, { recursive: true });
    writeFileSync(join(FAILURE_DIR, failureName), actual.png);
  }
  return diff;
}

const runs = CASES.flatMap((c) =>
  SIZES.map((size) => ({ c, size, file: goldenFile(c.name, size) })),
);

describe('golden images', () => {
  it('case names are unique', () => {
    expect(new Set(CASES.map((c) => c.name)).size).toBe(CASES.length);
  });

  it.each(runs)('$file', ({ c, size, file }) => {
    const path = join(GOLDEN_DIR, file);
    expect(existsSync(path), `${file} is missing: run npm run render:goldens`).toBe(true);
    const diff = compare(caseSvg(c, size), path, file);
    expect(diff.sameSize, `${file} has a different size`).toBe(true);
    expect(matches(diff), `${String(diff.differing)} of ${String(diff.total)} pixels differ`).toBe(
      true,
    );
  });

  it('has no golden without a case', () => {
    const wanted = new Set(runs.map((r) => r.file));
    const stale = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.png') && !wanted.has(f));
    expect(stale, 'stale goldens: run npm run render:goldens').toEqual([]);
  });

  it('renders/contact-sheet.png is current', () => {
    expect(existsSync(CONTACT_SHEET), 'run npm run render:goldens').toBe(true);
    const diff = compare(sheetSvg(), CONTACT_SHEET, 'contact-sheet.png');
    expect(matches(diff), `contact sheet: ${String(diff.differing)} pixels differ`).toBe(true);
  });
});
