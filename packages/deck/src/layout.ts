// Layouts for the Console profile (docs/design/03-ux.md §4): the bundled profile puts a Console
// Slot on every key of a Stream Deck XL, and each slot asks the layout what it is, by its
// coordinates, on the page the deck shows now. Pages and banks change instantly, without
// switching profiles. The default layout has three pages: Console, Inputs and Outputs.

import type { Bus } from '@faderlight/model';
import type { Coordinates } from './runtime.ts';
import { EMPTY, type Direction, type KeySpec } from './specs.ts';

/** A run of channel keys that moves together through the strips of a bus. */
export interface BankSpec {
  /** The bus it starts on; a long press on a bank key switches bus. */
  readonly bus: Bus;
  /** How many strips it shows (its strip keys are numbered 0 to size - 1). */
  readonly size: number;
}

export interface Page {
  readonly name: string;
  readonly bank?: BankSpec | undefined;
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
  readonly bus: Bus;
  /** Strip number (from 0) of its first key. */
  readonly offset: number;
}

export const BANK_BUSES: readonly Bus[] = ['input', 'playback', 'output'];

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

/** The same bank on the next bus, from its start. */
export function nextBankBus(at: BankPosition): BankPosition {
  const i = BANK_BUSES.indexOf(at.bus);
  return { bus: BANK_BUSES[(i + 1) % BANK_BUSES.length] ?? 'input', offset: 0 };
}

/** A bank's offset when the bus has fewer strips now (some were hidden in TotalMix). */
export const clampBank = (at: BankPosition, size: number, total: number): BankPosition =>
  at.offset > lastOffset(size, total) ? { ...at, offset: lastOffset(size, total) } : at;

// --- the default layout -------------------------------------------------------------------

const strips = (from: number, count: number, style?: 'meter'): KeySpec[] =>
  Array.from({ length: count }, (_, i) => ({ type: 'strip', n: from + i, style }) as const);

const MAIN = { role: 'main' } as const;
const PH1 = { role: 'phones', n: 1 } as const;
const PH2 = { role: 'phones', n: 2 } as const;

const CONSOLE: Page = {
  name: 'Console',
  bank: { bus: 'input', size: 8 },
  keys: [
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ type: 'snapshot', n }) as const),
    { type: 'status' },
    { type: 'page', direction: 'next' },

    ...strips(0, 8),

    { type: 'output', output: MAIN },
    { type: 'output', output: PH1 },
    { type: 'output', output: PH2 },
    { type: 'output', output: { role: 'output', index: 2 } },
    { type: 'toggle', function: 'dim' },
    { type: 'toggle', function: 'mono' },
    { type: 'toggle', function: 'talkback' },
    { type: 'bank', direction: 'next' },

    { type: 'step', output: MAIN, direction: 'down' },
    { type: 'step', output: MAIN, direction: 'up' },
    { type: 'step', output: PH1, direction: 'down' },
    { type: 'step', output: PH1, direction: 'up' },
    { type: 'step', output: PH2, direction: 'down' },
    { type: 'step', output: PH2, direction: 'up' },
    { type: 'toggle', function: 'globalMute' },
    { type: 'toggle', function: 'globalSolo' },
  ],
};

const INPUTS: Page = {
  name: 'Inputs',
  bank: { bus: 'input', size: 30 },
  keys: [
    ...strips(0, 30, 'meter'),
    { type: 'bank', direction: 'next' },
    { type: 'page', direction: 'next' },
  ],
};

const OUTPUTS: Page = {
  name: 'Outputs',
  bank: { bus: 'output', size: 24 },
  keys: [
    ...strips(0, 24),
    { type: 'step', output: MAIN, direction: 'down' },
    { type: 'step', output: MAIN, direction: 'up' },
    { type: 'toggle', function: 'dim' },
    { type: 'toggle', function: 'mono' },
    { type: 'toggle', function: 'speakerB' },
    { type: 'toggle', function: 'external' },
    { type: 'bank', direction: 'next' },
    { type: 'page', direction: 'next' },
  ],
};

/** The default layout for a Stream Deck XL (8 x 4). */
export const CONSOLE_LAYOUT: Layout = {
  columns: 8,
  rows: 4,
  pages: [CONSOLE, INPUTS, OUTPUTS],
};
