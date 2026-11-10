// Layouts for the Console profile (docs/design/03-ux.md §4): the bundled profile puts a Console
// Slot on every key of a Stream Deck XL, and each slot asks the layout what it is, by its
// coordinates, on the page the deck shows now. Pages and banks change instantly, without
// switching profiles. The default layout has three pages: Console, Inputs and Outputs; a page
// can have several banks, one per channel row.

import { BUSES, type Bus } from '@faderlight/model';
import type { Coordinates } from './runtime.ts';
import type { JsonObject, JsonValue } from './settings.ts';
import { EMPTY, type Direction, type KeySpec, type OutputRef } from './specs.ts';

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

// --- layouts in the global settings -------------------------------------------------------
//
// The Control Center's layout builder (M5.5) stores a layout of its own in the global
// settings. It is checked key by key: a key that is not one is left empty, so one bad key does
// not lose the rest.

/** At most this many pages. */
export const LAYOUT_PAGES_MAX = 16;
/** A page name: at most this many characters. */
export const PAGE_NAME_MAX = 24;

const isObject = (v: JsonValue | undefined): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function int(v: JsonValue | undefined, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
}

function oneOf<T extends string>(v: JsonValue | undefined, options: readonly T[]): T | undefined {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Leaves out the fields that are undefined, so a key reads back as it was written. */
function tidy<T extends object>(spec: T): T {
  return Object.fromEntries(Object.entries(spec).filter(([, v]) => v !== undefined)) as T;
}

function readOutputRef(v: JsonValue | undefined): OutputRef | undefined {
  if (!isObject(v)) return undefined;
  if (v.role === 'main') return { role: 'main' };
  const n = int(v.n, 1, 4);
  if (v.role === 'phones' && n !== undefined) return { role: 'phones', n: n as 1 | 2 | 3 | 4 };
  const index = int(v.index, 0, 1023);
  if (v.role === 'output' && index !== undefined) return { role: 'output', index };
  return undefined;
}

const STYLES = ['full', 'meter', 'minimal'] as const;
const DIRECTIONS = ['prev', 'next'] as const;
const TOGGLES = [
  'dim',
  'mono',
  'talkback',
  'speakerB',
  'external',
  'globalMute',
  'globalSolo',
] as const;

/** A key of a stored layout, or undefined when it is not one. */
export function readKeySpec(v: JsonValue | undefined): KeySpec | undefined {
  if (!isObject(v)) return undefined;
  switch (v.type) {
    case 'empty':
    case 'status':
    case 'console':
    case 'exit':
      return { type: v.type };
    case 'channel': {
      const bus = oneOf(v.bus, BUSES);
      if (bus === undefined) return undefined;
      return tidy<KeySpec>({
        type: 'channel',
        bus,
        index: int(v.index, 0, 1023),
        style: oneOf(v.style, STYLES),
        tap: oneOf(v.tap, ['mute', 'solo', 'none'] as const),
        hold: oneOf(v.hold, ['detail', 'solo', 'phantom', 'none'] as const),
      });
    }
    case 'output': {
      const output = readOutputRef(v.output);
      return output && { type: 'output', output };
    }
    case 'step': {
      const output = readOutputRef(v.output);
      const direction = oneOf(v.direction, ['up', 'down'] as const);
      return output && direction && { type: 'step', output, direction };
    }
    case 'preset': {
      const output = readOutputRef(v.output);
      const n = int(v.n, 1, 8);
      return output && n !== undefined ? { type: 'preset', output, n } : undefined;
    }
    case 'snapshot': {
      const n = int(v.n, 1, 8);
      return n === undefined ? undefined : { type: 'snapshot', n };
    }
    case 'toggle': {
      const fn = oneOf(v.function, TOGGLES);
      return fn && { type: 'toggle', function: fn };
    }
    case 'strip': {
      const n = int(v.n, 0, 255);
      if (n === undefined) return undefined;
      return tidy<KeySpec>({
        type: 'strip',
        n,
        style: oneOf(v.style, STYLES),
        bank: int(v.bank, 0, 31),
      });
    }
    case 'bank': {
      const direction = oneOf(v.direction, DIRECTIONS);
      return direction && tidy<KeySpec>({ type: 'bank', direction, bank: int(v.bank, 0, 31) });
    }
    case 'page':
      return tidy<KeySpec>({
        type: 'page',
        direction: oneOf(v.direction, DIRECTIONS),
        to: int(v.to, 0, LAYOUT_PAGES_MAX - 1),
      });
    default:
      // The Channel Detail overlay's keys are the runtime's own, not a layout's.
      return undefined;
  }
}

function readBanks(v: JsonValue | undefined, path: string, problems: string[]): BankSpec[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    problems.push(`${path}: expected a list of banks`);
    return [];
  }
  return v.flatMap((b, i) => {
    const source = isObject(b) ? oneOf(b.source, BANK_SOURCES) : undefined;
    const size = isObject(b) ? int(b.size, 1, 255) : undefined;
    if (source === undefined || size === undefined) {
      problems.push(`${path}.${String(i)}: expected a bank like {"source": "input", "size": 7}`);
      return [];
    }
    return [{ source, size }];
  });
}

/**
 * A layout from the global settings, checked: undefined when there is none (or nothing
 * usable), so the default applies. Problems are reported like the other settings'.
 */
export function readLayout(
  v: JsonValue | undefined,
  path: string,
  problems: string[],
): Layout | undefined {
  if (v === undefined || v === null) return undefined;
  const columns = isObject(v) ? int(v.columns, 1, 8) : undefined;
  const rows = isObject(v) ? int(v.rows, 1, 4) : undefined;
  const pages = isObject(v) && Array.isArray(v.pages) ? v.pages : undefined;
  if (columns === undefined || rows === undefined || !pages || pages.length === 0) {
    problems.push(`${path}: expected a layout with columns, rows and pages`);
    return undefined;
  }
  if (pages.length > LAYOUT_PAGES_MAX) {
    problems.push(`${path}.pages: more than ${String(LAYOUT_PAGES_MAX)} pages`);
  }
  const size = columns * rows;
  const out = pages.slice(0, LAYOUT_PAGES_MAX).map((p, i): Page => {
    const at = `${path}.pages.${String(i)}`;
    const page = isObject(p) ? p : {};
    if (!isObject(p)) problems.push(`${at}: expected a page`);
    const named = typeof page.name === 'string' ? page.name.trim().slice(0, PAGE_NAME_MAX) : '';
    const keys = Array.isArray(page.keys) ? page.keys : [];
    if (keys.length !== size) problems.push(`${at}.keys: expected ${String(size)} keys`);
    const banks = readBanks(page.banks, `${at}.banks`, problems);
    return {
      name: named === '' ? `Page ${String(i + 1)}` : named,
      ...(banks.length > 0 ? { banks } : {}),
      keys: Array.from({ length: size }, (_, k) => {
        if (k >= keys.length) return EMPTY;
        const spec = readKeySpec(keys[k]);
        if (!spec) problems.push(`${at}.keys.${String(k)}: not a key`);
        return spec ?? EMPTY;
      }),
    };
  });
  return { columns, rows, pages: out };
}
