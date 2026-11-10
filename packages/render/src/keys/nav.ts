// Navigation keys (docs/design/03-ux.md §2.3): Bank moves a row of channel keys by a bank
// of 8 ("IN 9–16 / 94"), Page switches the deck page. The arrow dims at the end.

import { triangle } from '../icons.ts';
import type { KeyState } from '../parts.ts';
import { text } from '../text.ts';
import type { Theme } from '../theme.ts';
import { caption, CENTER, chrome, functionLook, title, word } from './function.ts';

export interface BankKey extends KeyState {
  readonly kind: 'bank';
  readonly direction: 'prev' | 'next';
  /** Which row it moves, e.g. "INPUTS", "PLAYBACK", "OUTPUTS". */
  readonly row: string;
  /** First and last channel number shown now (1-based), and how many there are. */
  readonly first: number;
  readonly last: number;
  readonly total: number;
  /** No further bank in this direction. */
  readonly atEnd?: boolean | undefined;
}

export interface PageKey extends KeyState {
  readonly kind: 'page';
  readonly direction?: 'prev' | 'next' | undefined;
  /** Name of the page it goes to. */
  readonly name: string;
  /** Current page (1-based) and page count. */
  readonly index: number;
  readonly count: number;
}

const EN_DASH = '–';

export function renderBank(theme: Theme, k: BankKey): string {
  const l = functionLook(theme, k);
  const c = chrome(theme, l, '', k);
  const arrow = k.atEnd === true ? theme.line : l.text;
  const range = `${String(k.first)}${EN_DASH}${String(k.last)}`;
  return (
    c.under +
    title(theme, k.row.toUpperCase(), l, 28) +
    triangle(CENTER, 58, 28, k.direction === 'next' ? 'right' : 'left', arrow) +
    word(theme, range, l, 108, [theme.type.medium]) +
    caption(theme, `of ${String(k.total)}`, l, 130) +
    c.over
  );
}

export function renderPage(theme: Theme, k: PageKey): string {
  const l = functionLook(theme, k);
  const c = chrome(theme, l, '', k);
  const direction = k.direction ?? 'next';
  return (
    c.under +
    text(`PAGE ${String(k.index)} / ${String(k.count)}`, {
      face: 'semibold',
      size: theme.type.small,
      tracking: 0.6,
      x: CENTER,
      y: 28,
      anchor: 'middle',
      fill: l.subtext,
    }) +
    triangle(CENTER, 62, 30, direction === 'next' ? 'right' : 'left', l.text) +
    word(theme, k.name, l, 116, [theme.type.medium, theme.type.small]) +
    c.over
  );
}
