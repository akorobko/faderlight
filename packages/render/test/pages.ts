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
  color,
  value: { kind: 'gain', db: 0, caption: 'Gain' },
  meter: { left: meter(level) },
  ...over,
});

const snapshots = ['Default', 'Tracking', 'Mixdown', 'Podcast', 'Live', 'Reference'];

const console: KeyView[] = [
  ...snapshots.map((name, i): KeyView => ({
    kind: 'snapshot',
    n: i + 1,
    name,
    state: i === 1 ? 'active' : 'inactive',
  })),
  { kind: 'status', link: 'live', device: 'Fireface UFX III', beat: true },
  { kind: 'page', name: 'Inputs', index: 1, count: 4 },

  mic(9, 'Vocal', 1, 42, -16, {
    badges: { phantom: true, phase: false, instrument: false, autoSet: false },
  }),
  mic(10, 'Kick In', 6, 28, -3, {
    meter: { left: meter(-3, 0, true) },
    badges: { phantom: false, phase: true, instrument: false, autoSet: false },
  }),
  mic(11, 'Snare', 6, 31, -9, { muted: true }),
  mic(12, 'Guitar DI', 4, 18, -20, {
    soloed: true,
    badges: { phantom: false, phase: false, instrument: true, autoSet: false },
  }),
  line(1, 'Synth L', 7, -24),
  line(2, 'Synth R', 7, -25),
  line(3, 'Drum Mach', 2, -100),
  line(4, 'Talkback', 0, -100),

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
    label: 'PH 11/12',
    name: 'Artist',
    volume: -20,
    muted: true,
    meter: { left: meter(-30), right: meter(-31) },
  },
  {
    kind: 'output',
    role: 'output',
    label: 'AN 3/4',
    name: 'NS10',
    volume: -10,
    meter: { left: meter(-100), right: meter(-100) },
  },
  { kind: 'toggle', function: 'dim', on: true, caption: `${MINUS}20 dB` },
  { kind: 'toggle', function: 'mono', on: false, caption: 'Main out' },
  { kind: 'toggle', function: 'talkback', on: false, caption: 'hold to talk' },
  { kind: 'bank', direction: 'next', row: 'Inputs', first: 9, last: 16, total: 94 },

  { kind: 'step', direction: 'down', target: 'Main', db: -18.5 },
  { kind: 'step', direction: 'up', target: 'Main', db: -18.5 },
  { kind: 'step', direction: 'down', target: 'Phones 1', db: -12 },
  { kind: 'step', direction: 'up', target: 'Phones 1', db: -12 },
  { kind: 'step', direction: 'down', target: 'Phones 2', db: -20 },
  { kind: 'step', direction: 'up', target: 'Phones 2', db: -20 },
  { kind: 'toggle', function: 'globalMute', on: false },
  { kind: 'toggle', function: 'globalSolo', on: true, caption: '1 soloed' },
];

// Inputs page: 32 meter-style keys, a monitoring wall.
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

const inputs: KeyView[] = NAMES.map((name, i): KeyView => {
  const level = LEVELS[i] ?? -100;
  return {
    kind: 'channel',
    style: 'meter',
    label: i < 28 ? `IN ${String(i + 1)}` : `ADAT ${String(i - 27)}`,
    name,
    color: 1 + (Math.floor(i / 4) % 8),
    meter: { left: meter(level, level + 6, i === 0) },
    muted: i === 26 || i === 27,
    soloed: i === 20,
  };
});

// The Channel Detail overlay on Vocal (docs/design/03-ux.md §3.1), with Phones 1 selected.
const vocal = mic(9, 'Vocal', 1, 42, -16, {
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
  { ...vocal, style: 'meter' },
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
