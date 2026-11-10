// Where golden images live and how a case renders to one.

import { join } from 'node:path';
import { DARK, renderKey } from '../src/index.ts';
import type { Case } from './cases.ts';
import { contactSheet } from './contact-sheet.ts';
import { CONSOLE_PAGES } from './pages.ts';

export const GOLDEN_DIR = join(import.meta.dirname, 'goldens');
export const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
export const CONTACT_SHEET = join(REPO_ROOT, 'renders', 'contact-sheet.png');
/** Renders that did not match their golden, for looking at (gitignored). */
export const FAILURE_DIR = join(REPO_ROOT, 'renders', 'failures');

export const goldenFile = (name: string, size: number): string => `${name}@${String(size)}.png`;

export function caseSvg(c: Case, size: number): string {
  return renderKey(c.view, c.theme ?? DARK, size);
}

export function sheetSvg(): string {
  return contactSheet(undefined, CONSOLE_PAGES);
}
