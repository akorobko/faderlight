// Theme tokens: every colour, type size and meter setting a key uses. Sizes are on the
// 144 x 144 key canvas (the Stream Deck XL shows keys at 96 px, two thirds of that).
//
// Colour language follows the mixer (docs/design/03-ux.md §1): mute is cyan/teal, solo
// orange, phantom power and record red, dim amber, an active control blue-grey. Every state
// also has a shape (M/S chips, frames, filled vs outlined badges), so colour is never the
// only cue.

import type { Hex } from './color.ts';

export interface MeterTokens {
  /** Bottom of the meter scale in dBFS (the top is 0 dBFS). */
  readonly floorDb: number;
  /** Zone boundaries in dBFS: green below `yellow`, then yellow, orange, red from `red`. */
  readonly yellow: number;
  readonly orange: number;
  readonly red: number;
  readonly green: Hex;
  readonly yellowColor: Hex;
  readonly orangeColor: Hex;
  readonly redColor: Hex;
  /** Unlit part of the bar: each zone's colour mixed this far into the background. */
  readonly unlit: number;
  readonly peak: Hex;
  readonly clip: Hex;
  readonly clipOff: Hex;
  /** Below this level a channel counts as silent (the signal dot of the Minimal style). */
  readonly signalDb: number;
}

export interface StateTokens {
  /** Key background. */
  readonly background: Hex;
  /** Main text (names, values). */
  readonly text: Hex;
  /** Secondary text (labels, captions, units). */
  readonly subtext: Hex;
}

export interface Theme {
  readonly name: string;
  readonly normal: StateTokens;
  /** Muted channel: a teal pad, text desaturates. */
  readonly muted: StateTokens;
  /** Soloed channel: an orange-brown pad. */
  readonly soloed: StateTokens;
  /** Mixer not reachable: everything grey. */
  readonly offline: StateTokens & { readonly hatch: Hex };
  /** Lit function key (an active toggle, the loaded snapshot). */
  readonly lit: StateTokens & { readonly frame: Hex };
  /** Lines and outlines on a normal key (off badges, separators). */
  readonly line: Hex;
  readonly accent: {
    readonly mute: Hex;
    readonly muteInk: Hex;
    readonly solo: Hex;
    readonly soloInk: Hex;
    readonly phantom: Hex;
    readonly phantomInk: Hex;
    readonly record: Hex;
    readonly dim: Hex;
    readonly dimInk: Hex;
    readonly play: Hex;
    readonly active: Hex;
    readonly activeInk: Hex;
    readonly pending: Hex;
    readonly confirm: Hex;
  };
  readonly link: { readonly live: Hex; readonly busy: Hex; readonly lost: Hex; readonly idle: Hex };
  readonly meter: MeterTokens;
  /** Type scale: at most these sizes on a key (docs/design/03-ux.md §1). */
  readonly type: {
    readonly small: number;
    readonly medium: number;
    readonly large: number;
    readonly display: number;
  };
  /** Pending frame width and dash, in px. */
  readonly frame: {
    readonly pending: number;
    readonly dash: readonly number[];
  };
  /**
   * Channel colours by the mixer's colour number (docs/protocol/global-osc.md §6). 1 is
   * TotalMix's "no colour", so it has none. 3, 5 and 6 are TotalMix's own label colours; the
   * numbers not mapped yet have placeholders.
   */
  readonly channelColors: Readonly<Partial<Record<number, Hex>>>;
}

const DARK_BG: Hex = '#16181c';
const MUTE_BG: Hex = '#0d2a2d';

export const DARK: Theme = {
  name: 'dark',
  normal: { background: DARK_BG, text: '#f2f4f7', subtext: '#8f97a3' },
  muted: { background: MUTE_BG, text: '#a7d3d5', subtext: '#68a2a5' },
  soloed: { background: '#3e2c18', text: '#fff4e6', subtext: '#ffc98a' },
  offline: { background: '#111215', text: '#737a84', subtext: '#646a74', hatch: '#1a1c20' },
  lit: { background: '#22405f', text: '#ffffff', subtext: '#c9ddf5', frame: '#4ea1ff' },
  line: '#3a3f47',
  accent: {
    mute: '#2ccfd3',
    muteInk: '#032326',
    solo: '#ff9a1f',
    soloInk: '#2a1500',
    phantom: '#d6343a',
    phantomInk: '#ffffff',
    record: '#ff3b3b',
    dim: '#f0b429',
    dimInk: '#231800',
    play: '#3ddc84',
    active: '#4ea1ff',
    activeInk: '#04172b',
    pending: '#a6aeba',
    confirm: '#c4161c',
  },
  link: { live: '#3ddc84', busy: '#f0b429', lost: '#ff4d4d', idle: '#5a6069' },
  meter: {
    floorDb: -60,
    yellow: -18,
    orange: -6,
    red: -1,
    green: '#2fbf71',
    yellowColor: '#e8c547',
    orangeColor: '#ff8a3d',
    redColor: '#ff4d4d',
    unlit: 0.82,
    peak: '#ffffff',
    clip: '#ff3b3b',
    clipOff: '#2c2f35',
    signalDb: -50,
  },
  type: { small: 15, medium: 22, large: 36, display: 52 },
  frame: { pending: 3, dash: [9, 6] },
  channelColors: {
    2: '#e5484d', // placeholder
    3: '#ff6e0a', // orange
    4: '#f5d90a', // placeholder
    5: '#3c8cff', // blue
    6: '#00f027', // green
    7: '#b07cff', // placeholder
    8: '#ff6fae', // placeholder
  },
};

/** Black background, white text, stronger accents and a thicker pending frame. */
export const HIGH_CONTRAST: Theme = {
  ...DARK,
  name: 'high-contrast',
  normal: { background: '#000000', text: '#ffffff', subtext: '#d0d4da' },
  muted: { background: '#00474b', text: '#ffffff', subtext: '#b9ecee' },
  soloed: { background: '#5a3a10', text: '#ffffff', subtext: '#ffe0b8' },
  offline: { background: '#000000', text: '#80868f', subtext: '#6b7079', hatch: '#202226' },
  lit: { background: '#0b3d75', text: '#ffffff', subtext: '#ffffff', frame: '#8cc4ff' },
  line: '#8a919b',
  accent: { ...DARK.accent, mute: '#4ff2f5', solo: '#ffad42', pending: '#ffffff' },
  meter: { ...DARK.meter, unlit: 0.9 },
  frame: { pending: 4, dash: [10, 6] },
};

export const THEMES: Readonly<Record<string, Theme>> = {
  [DARK.name]: DARK,
  [HIGH_CONTRAST.name]: HIGH_CONTRAST,
};
