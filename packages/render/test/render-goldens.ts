// Regenerates the golden images (test/goldens/) and renders/contact-sheet.png.
// Run after every renderer change: npm run render:goldens

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { CASES, SIZES } from './cases.ts';
import { caseSvg, CONTACT_SHEET, GOLDEN_DIR, goldenFile, REPO_ROOT, sheetSvg } from './goldens.ts';
import { initRaster, rasterize } from './raster.ts';

await initRaster();
mkdirSync(GOLDEN_DIR, { recursive: true });

const wanted = new Set<string>();
for (const c of CASES) {
  for (const size of SIZES) {
    const file = goldenFile(c.name, size);
    wanted.add(file);
    writeFileSync(join(GOLDEN_DIR, file), rasterize(caseSvg(c, size)).png);
  }
}
let removed = 0;
for (const file of readdirSync(GOLDEN_DIR)) {
  if (file.endsWith('.png') && !wanted.has(file)) {
    rmSync(join(GOLDEN_DIR, file));
    removed++;
  }
}

mkdirSync(dirname(CONTACT_SHEET), { recursive: true });
const sheet = rasterize(sheetSvg());
writeFileSync(CONTACT_SHEET, sheet.png);

console.log(
  `${String(wanted.size)} goldens in ${relative(REPO_ROOT, GOLDEN_DIR)}` +
    (removed > 0 ? ` (${String(removed)} stale removed)` : '') +
    `; contact sheet ${String(sheet.width)}x${String(sheet.height)} at ${relative(REPO_ROOT, CONTACT_SHEET)}`,
);
