// Layout templates for the Control Center's layout builder (docs/design/03-ux.md §5.2): starting
// points for a Stream Deck XL (8 x 4) that the builder copies into the settings. Studio Console
// is the default layout itself.

import { CONSOLE_LAYOUT, type Layout, type Page } from './layout.ts';
import type { KeySpec } from './specs.ts';

export interface LayoutTemplate {
  readonly id: string;
  readonly name: string;
  /** One sentence for the template list. */
  readonly description: string;
  readonly layout: Layout;
}

const strips = (from: number, count: number, style?: 'meter', bank = 0): KeySpec[] =>
  Array.from({ length: count }, (_, i) =>
    style === undefined
      ? ({ type: 'strip', n: from + i, bank } as const)
      : ({ type: 'strip', n: from + i, style, bank } as const),
  );

const MAIN = { role: 'main' } as const;
const PH1 = { role: 'phones', n: 1 } as const;
const PH2 = { role: 'phones', n: 2 } as const;

// Recording: two rows of inputs in one bank, Talkback, and the cue mixes' levels at hand.
const TRACKING: Page = {
  name: 'Tracking',
  banks: [{ source: 'input', size: 14 }],
  keys: [
    ...[1, 2, 3, 4].map((n) => ({ type: 'snapshot', n }) as const),
    { type: 'toggle', function: 'talkback' },
    { type: 'toggle', function: 'globalSolo' },
    { type: 'status' },
    { type: 'page', direction: 'next' },

    ...strips(0, 7),
    { type: 'bank', direction: 'next' },

    ...strips(7, 7),
    { type: 'bank', direction: 'prev' },

    { type: 'output', output: MAIN },
    { type: 'output', output: PH1 },
    { type: 'step', output: PH1, direction: 'down' },
    { type: 'step', output: PH1, direction: 'up' },
    { type: 'output', output: PH2 },
    { type: 'step', output: PH2, direction: 'down' },
    { type: 'step', output: PH2, direction: 'up' },
    { type: 'exit' },
  ],
};

const TRACKING_INPUTS: Page = {
  name: 'Inputs',
  banks: [{ source: 'input', size: 29 }],
  keys: [
    ...strips(0, 7, 'meter'),
    { type: 'page', to: 0 },
    ...strips(7, 22, 'meter'),
    { type: 'bank', direction: 'next' },
    { type: 'exit' },
  ],
};

// Listening: one page of Main, the Phones and the monitor switches, with the software returns
// and the other outputs in one bank.
const MONITOR: Page = {
  name: 'Monitor',
  banks: [{ source: 'playback+output', size: 7 }],
  keys: [
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ type: 'snapshot', n }) as const),
    { type: 'status' },
    { type: 'exit' },

    { type: 'output', output: MAIN },
    { type: 'step', output: MAIN, direction: 'down' },
    { type: 'step', output: MAIN, direction: 'up' },
    { type: 'preset', output: MAIN, n: 1 },
    { type: 'preset', output: MAIN, n: 2 },
    { type: 'toggle', function: 'dim' },
    { type: 'toggle', function: 'mono' },
    { type: 'toggle', function: 'talkback' },

    { type: 'output', output: PH1 },
    { type: 'step', output: PH1, direction: 'down' },
    { type: 'step', output: PH1, direction: 'up' },
    { type: 'output', output: PH2 },
    { type: 'step', output: PH2, direction: 'down' },
    { type: 'step', output: PH2, direction: 'up' },
    { type: 'toggle', function: 'speakerB' },
    { type: 'toggle', function: 'external' },

    ...strips(0, 7),
    { type: 'bank', direction: 'next' },
  ],
};

export const LAYOUT_TEMPLATES: readonly LayoutTemplate[] = [
  {
    id: 'console',
    name: 'Studio Console',
    description:
      'Snapshots, two banks of channels, Main and the Phones; Inputs and Outputs pages with meters.',
    layout: CONSOLE_LAYOUT,
  },
  {
    id: 'tracking',
    name: 'Tracking',
    description:
      'Fourteen inputs in one bank, Talkback, and the levels of Phones 1 and 2 for the cue mixes.',
    layout: { columns: 8, rows: 4, pages: [TRACKING, TRACKING_INPUTS] },
  },
  {
    id: 'monitoring',
    name: 'Monitoring only',
    description:
      'Main and the Phones with their levels, Dim, Mono and the speaker switches, and one bank of returns.',
    layout: { columns: 8, rows: 4, pages: [MONITOR] },
  },
];
