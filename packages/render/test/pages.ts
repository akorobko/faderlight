// Whole deck pages for the contact sheet, drawn at Stream Deck XL size (96 px): the default
// Console page from docs/design/03-ux.md §4 and an Inputs page of meter-style keys.

import { MINUS, type ChannelKey, type KeyView, type MeterLevel } from '../src/index.ts';
import type { DeckPage } from './contact-sheet.ts';

const meter = (level: number, peak = level + 5, clip = false): MeterLevel => ({
  level,
  peak,
  clip,
});

const mic = (
  n: number,
  name: string,
  color: number,
  gain: number,
  level: number,
  over: Partial<ChannelKey> = {},
): ChannelKey => ({
  kind: 'channel',
  label: `MIC ${String(n)}`,
  name,
  source: 'input',
  color,
  value: { kind: 'gain', db: gain, caption: 'Gain' },
  meter: { left: meter(level) },
  badges: { phantom: false, phase: false, instrument: false, autoSet: false },
  ...over,
});

const line = (
  n: number,
  name: string,
  color: number,
  level: number,
  over: Partial<ChannelKey> = {},
): ChannelKey => ({
  kind: 'channel',
  label: `AN ${String(n)}`,
  name,
  source: 'input',
  color,
  value: { kind: 'gain', db: 0, caption: 'Gain' },
  meter: { left: meter(level) },
  ...over,
});

const snapshots = ['Tracking', 'Overdubs', 'Mixdown', 'Reference'];

const playback = (n: number, name: string, db: number, level: number): ChannelKey => ({
  kind: 'channel',
  label: `PB ${String(n)}/${String(n + 1)}`,
  name,
  source: 'playback',
  value: { kind: 'level', db, caption: 'Fader' },
  meter: { left: meter(level), right: meter(level - 1) },
  badges: { stereo: true },
});

const output = (label: string, name: string, volume: number, level: number): KeyView => ({
  kind: 'output',
  role: 'output',
  label,
  name,
  volume,
  meter: { left: meter(level), right: meter(level - 1) },
});

// The default Console page (packages/deck/src/layout.ts) on a small studio setup.
const console: (KeyView | undefined)[] = [
  ...snapshots.map((name, i): KeyView => ({
    kind: 'snapshot',
    n: i + 1,
    name,
    state: i === 1 ? 'active' : 'inactive',
  })),
  { kind: 'toggle', function: 'dim', on: true, caption: `${MINUS}20 dB` },
  { kind: 'toggle', function: 'mono', on: false, caption: 'Main out' },
  { kind: 'status', link: 'live', device: 'Fireface UFX III', beat: true },
  { kind: 'page', name: 'Inputs', index: 1, count: 3 },

  mic(9, 'Vocal', 3, 42, -16, {
    badges: { phantom: true, phase: false, instrument: false, autoSet: false },
  }),
  mic(10, 'Kick In', 6, 28, -3, {
    meter: { left: meter(-3, 0, true) },
    badges: { phantom: false, phase: true, instrument: false, autoSet: false },
  }),
  mic(11, 'Snare', 6, 31, -9, { muted: true }),
  mic(12, 'Guitar DI', 5, 18, -20, {
    soloed: true,
    badges: { phantom: false, phase: false, instrument: true, autoSet: false },
  }),
  line(1, 'Synth L', 5, -24),
  line(2, 'Synth R', 5, -25),
  line(3, 'Drum Mach', 1, -100),
  { kind: 'bank', direction: 'next', row: 'Inputs', first: 1, last: 7, total: 12 },

  playback(1, 'DAW', -6, -14),
  playback(3, 'Browser', -12, -30),
  playback(5, 'Calls', -10, -100),
  output('AN 3/4', 'NS10', -10, -100),
  output('AN 5/6', 'Reamp', 0, -18),
  output('AN 7/8', 'Gtr Ret', -3, -26),
  output('ADAT 1/2', 'To PC', 0, -22),
  {
    kind: 'bank',
    direction: 'next',
    row: 'Play + Out',
    first: 1,
    last: 7,
    total: 7,
    atEnd: true,
  },

  {
    kind: 'output',
    role: 'main',
    label: 'AN 1/2',
    name: 'Monitors',
    volume: -18.5,
    meter: { left: meter(-20), right: meter(-21) },
    monitor: { dim: true },
  },
  {
    kind: 'output',
    role: 'phones',
    title: 'PHONES 1',
    label: 'PH 9/10',
    name: 'Cue Mix',
    volume: -12,
    meter: { left: meter(-24), right: meter(-25) },
  },
  {
    kind: 'output',
    role: 'phones',
    title: 'PHONES 2',
    label: '',
    name: 'Not assigned',
    volume: undefined,
    unassigned: true,
  },
  {
    kind: 'control',
    title: 'Main preset',
    word: `${MINUS}20.0 dB`,
    caption: 'hold to save',
  },
  undefined,
  undefined,
  undefined,
  { kind: 'control', title: 'Console', arrow: 'left', word: 'EXIT', caption: 'my profile' },
];

// Inputs page: meter-style keys, a monitoring wall.
const NAMES = [
  'Kick In',
  'Kick Out',
  'Snare Top',
  'Snare Bot',
  'Hi-Hat',
  'Tom 1',
  'Tom 2',
  'Floor Tom',
  'OH L',
  'OH R',
  'Room L',
  'Room R',
  'Bass DI',
  'Bass Amp',
  'Gtr 1',
  'Gtr 2',
  'Keys L',
  'Keys R',
  'Synth L',
  'Synth R',
  'Vocal',
  'BV 1',
  'BV 2',
  'BV 3',
  'Click',
  'Talkback',
  'Spare',
  'Spare',
  'ADAT 1',
  'ADAT 2',
  'ADAT 3',
  'ADAT 4',
];
const LEVELS = [
  -6, -9, -12, -20, -28, -14, -16, -18, -22, -21, -30, -31, -10, -12, -15, -17, -24, -25, -19, -20,
  -8, -26, -27, -100, -100, -100, -100, -100, -40, -38, -100, -100,
];

const meters: KeyView[] = NAMES.slice(0, 29).map((name, i): KeyView => {
  const level = LEVELS[i] ?? -100;
  return {
    kind: 'channel',
    style: 'meter',
    label: i < 28 ? `IN ${String(i + 1)}` : `ADAT ${String(i - 27)}`,
    name,
    color: [3, 5, 6, 1][Math.floor(i / 4) % 4],
    meter: { left: meter(level, level + 6, i === 0) },
    muted: i === 26 || i === 27,
    soloed: i === 20,
  };
});

// Like packages/deck/src/layout.ts: the Console key top right, the bank and page keys last.
const inputs: KeyView[] = [
  ...meters.slice(0, 7),
  { kind: 'page', direction: 'prev', name: 'Console', index: 2, count: 3 },
  ...meters.slice(7),
  { kind: 'bank', direction: 'next', row: 'Inputs', first: 1, last: 29, total: 32 },
  { kind: 'page', name: 'Outputs', index: 2, count: 3 },
];

// The Channel Detail overlay on Vocal (docs/design/03-ux.md §3.1), with Phones 1 selected.
const vocal = mic(9, 'Vocal', 3, 42, -16, {
  badges: { phantom: true, phase: false, instrument: false, autoSet: false },
});
const send = (title: string, name: string, db: string, lit = false): KeyView => ({
  kind: 'control',
  title,
  word: db,
  caption: name,
  lit,
});
const detail: (KeyView | undefined)[] = [
  { kind: 'control', title: 'Detail', arrow: 'left', word: 'BACK' },
  vocal,
  { kind: 'control', title: 'Gain', arrow: 'down', word: '+42 dB' },
  { kind: 'control', title: 'Gain', arrow: 'up', word: '+42 dB' },
  { kind: 'control', title: 'Phantom', word: '48V', switch: true, color: 'phantom' },
  { kind: 'control', title: 'Phase', word: 'Ø', switch: false },
  { kind: 'control', title: 'Input', word: 'INST', switch: false },
  { kind: 'control', title: 'Autoset', word: 'AUTO', switch: true },

  { kind: 'control', title: 'Channel', word: 'MUTE', switch: false, color: 'mute' },
  { kind: 'control', title: 'Channel', word: 'SOLO', switch: false, color: 'solo' },
  { kind: 'control', title: 'Fader', arrow: 'down', word: `${MINUS}6.0` },
  { kind: 'control', title: 'Fader', arrow: 'up', word: `${MINUS}6.0` },
  { ...vocal, style: 'meter', name: undefined }, // the physical label
  { kind: 'control', title: 'Low cut', word: '80 Hz', switch: true },
  { kind: 'control', title: 'EQ', word: 'EQ', switch: true },
  { kind: 'control', title: 'Dynamics', word: 'DYN', switch: false },

  send('→ AN 1/2', 'Main', `${MINUS}6.0`),
  send('→ PH 9/10', 'Phones 1', `${MINUS}3.0`, true),
  send('→ PH 11/12', 'Phones 2', `${MINUS}6.0`),
  send('→ AN 3/4', 'Monitors', '−∞'),
  send('→ ADAT 1/2', 'Artist', '−∞'),
  { kind: 'control', title: 'FX send', word: `${MINUS}20.0`, caption: 'FX' },
  { kind: 'control', title: 'Pan PH 9/10', arrow: 'left', word: 'L20' },
  { kind: 'control', title: 'Pan PH 9/10', arrow: 'right', word: 'L20' },

  { kind: 'control', title: 'Channel', arrow: 'left', word: 'AN 7/8' },
  { kind: 'control', title: 'Channel', arrow: 'right', word: 'MIC 10' },
  { kind: 'control', title: 'Send → PH 9/10', arrow: 'down', word: `${MINUS}3.0` },
  { kind: 'control', title: 'Send → PH 9/10', arrow: 'up', word: `${MINUS}3.0` },
  undefined,
  undefined,
  { kind: 'control', title: 'Meter', word: 'CLEAR', caption: 'clip & peak', color: 'record' },
  { kind: 'control', title: 'Detail', arrow: 'left', word: 'BACK' },
];

export const CONSOLE_PAGES: readonly DeckPage[] = [
  { title: 'Console page on a Stream Deck XL (96 px keys)', keys: console },
  { title: 'Inputs page, meter style (96 px keys)', keys: inputs },
  { title: 'Channel Detail overlay (96 px keys)', keys: detail },
];
