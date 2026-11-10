// Layouts for the Console profile (docs/design/03-ux.md §4): the bundled profile puts a Console
// Slot on every key of a Stream Deck XL, and each slot asks the layout what it is, by its
// coordinates, on the page the deck shows now. Pages and banks change instantly, without
// switching profiles. The default layout has three pages: Console, Inputs and Outputs; a page
// can have several banks, one per channel row.

import type { Bus } from '@faderlight/model';
import type { Coordinates } from './runtime.ts';
import { EMPTY, type Direction, type KeySpec } from './specs.ts';

/**
 * What a bank pages through: the strips of one bus, or the playback strips followed by the
 * outputs that have no key of their own on the Console page (all but Main and the Phones
 * outputs), so one row shows the software returns and the hardware outputs of a small setup.
 */
export type BankSource = Bus | 'playback+output';

/** A run of channel keys that moves together through the strips of a source. */
export interface BankSpec {
  /** The source it starts on; a long press on its bank key switches to the next. */
  readonly source: BankSource;
  /** How many strips it shows (its strip keys are numbered 0 to size - 1). */
  readonly size: number;
}

export interface Page {
  readonly name: string;
  /** The page's banks; strip and bank keys name theirs by its place here (default 0). */
  readonly banks?: readonly BankSpec[] | undefined;
  /** Row by row, `columns * rows` of them. */
  readonly keys: readonly KeySpec[];
}

export interface Layout {
  readonly columns: number;
  readonly rows: number;
  readonly pages: readonly Page[];
}

/** Where a bank is now. */
export interface BankPosition {
  readonly source: BankSource;
  /** Strip number (from 0) of its first key. */
  readonly offset: number;
}

/** The sources a long press on a bank key goes through, in order. */
export const BANK_SOURCES: readonly BankSource[] = [
  'input',
  'playback',
  'output',
  'playback+output',
];

/** The spec of the key at some coordinates of a page; empty outside the grid. */
export function keyAt(layout: Layout, page: number, at: Coordinates | undefined): KeySpec {
  if (!at || at.column >= layout.columns || at.row >= layout.rows) return EMPTY;
  return layout.pages[page]?.keys[at.row * layout.columns + at.column] ?? EMPTY;
}

/** The offset of the last bank, so that it starts on a multiple of the size. */
const lastOffset = (size: number, total: number): number =>
  total <= size ? 0 : Math.floor((total - 1) / size) * size;

/** Moves a bank by its size, wrapping around at either end. */
export function moveBank(
  at: BankPosition,
  size: number,
  total: number,
  direction: Direction,
): BankPosition {
  const last = lastOffset(size, total);
  const offset = Math.min(at.offset, last);
  if (direction === 'next') return { ...at, offset: offset >= last ? 0 : offset + size };
  return { ...at, offset: offset <= 0 ? last : offset - size };
}

/** The same bank on the next source, from its start. */
export function nextBankSource(at: BankPosition): BankPosition {
  const i = BANK_SOURCES.indexOf(at.source);
  return { source: BANK_SOURCES[(i + 1) % BANK_SOURCES.length] ?? 'input', offset: 0 };
}

/** A bank's offset when the source has fewer strips now (some were hidden in TotalMix). */
export const clampBank = (at: BankPosition, size: number, total: number): BankPosition =>
  at.offset > lastOffset(size, total) ? { ...at, offset: lastOffset(size, total) } : at;

// --- the default layout -------------------------------------------------------------------
//
// From the first run on a real XL: the top-right key is a page key on every page (on the
// overview pages it reads "Console" and goes back), each channel row ends in the bank key that
// moves it, and the bottom-right key leaves the Console for the profile the deck showed before.
// Dim and Mono sit with Main on the bottom row, so the top row has room for six snapshots.

const strips = (from: number, count: number, style?: 'meter', bank = 0): KeySpec[] =>
  Array.from({ length: count }, (_, i) => ({ type: 'strip', n: from + i, style, bank }) as const);

const MAIN = { role: 'main' } as const;
const PH1 = { role: 'phones', n: 1 } as const;
const PH2 = { role: 'phones', n: 2 } as const;

const TO_CONSOLE: KeySpec = { type: 'page', to: 0 };

const CONSOLE: Page = {
  name: 'Console',
  banks: [
    { source: 'input', size: 7 },
    { source: 'playback+output', size: 7 },
  ],
  keys: [
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ type: 'snapshot', n }) as const),
    { type: 'status' },
    { type: 'page', direction: 'next' },

    ...strips(0, 7),
    { type: 'bank', direction: 'next', bank: 0 },

    ...strips(0, 7, undefined, 1),
    { type: 'bank', direction: 'next', bank: 1 },

    { type: 'output', output: MAIN },
    { type: 'output', output: PH1 },
    { type: 'output', output: PH2 },
    { type: 'preset', output: MAIN, n: 1 },
    { type: 'toggle', function: 'dim' },
    { type: 'toggle', function: 'mono' },
    EMPTY,
    { type: 'exit' },
  ],
};

const INPUTS: Page = {
  name: 'Inputs',
  banks: [{ source: 'input', size: 29 }],
  keys: [
    ...strips(0, 7, 'meter'),
    TO_CONSOLE,
    ...strips(7, 22, 'meter'),
    { type: 'bank', direction: 'next' },
    { type: 'page', to: 2 },
  ],
};

const OUTPUTS: Page = {
  name: 'Outputs',
  banks: [{ source: 'output', size: 23 }],
  keys: [
    ...strips(0, 7),
    TO_CONSOLE,
    ...strips(7, 16),
    { type: 'toggle', function: 'dim' },
    { type: 'toggle', function: 'mono' },
    { type: 'toggle', function: 'speakerB' },
    { type: 'toggle', function: 'external' },
    EMPTY,
    EMPTY,
    { type: 'bank', direction: 'next' },
    { type: 'page', to: 1 },
  ],
};

/** The default layout for a Stream Deck XL (8 x 4). */
export const CONSOLE_LAYOUT: Layout = {
  columns: 8,
  rows: 4,
  pages: [CONSOLE, INPUTS, OUTPUTS],
};
