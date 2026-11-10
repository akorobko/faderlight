// Where capture files go and how they are named.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (this file is tools/capture/src/paths.ts). */
export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export const capturesDir = join(repoRoot, 'fixtures', 'captures');

export function slug(text: string): string {
  const s = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return s === '' ? 'unknown' : s;
}

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `<device>-<tmfx-version>-<date><suffix>.jsonl`, e.g. fireface-ufx-iii-2.10-2026-11-10.jsonl */
export function fixtureName(
  device: string,
  tmfxVersion: string,
  date: string,
  suffix = '',
): string {
  return `${slug(device)}-${slug(tmfxVersion)}-${date}${suffix}.jsonl`;
}

/** Appends -2, -3, ... before the extension until the path does not exist. */
export function uniquePath(dir: string, name: string): string {
  const base = name.replace(/\.jsonl$/, '');
  let candidate = join(dir, name);
  for (let n = 2; existsSync(candidate); n++) candidate = join(dir, `${base}-${String(n)}.jsonl`);
  return candidate;
}
