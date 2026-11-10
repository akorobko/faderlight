// The golden cases: every key type in each state worth looking at. Each case is rendered at
// 96 and 144 px into test/goldens/ and laid out on renders/contact-sheet.png.

import {
  HIGH_CONTRAST,
  MINUS,
  type ChannelKey,
  type KeyView,
  type MeterLevel,
  type OutputKey,
  type Theme,
} from '../src/index.ts';

export interface Case {
  /** File name stem: test/goldens/<name>@<size>.png. */
  readonly name: string;
  /** Caption on the contact sheet. */
  readonly title: string;
  readonly group: string;
  readonly view: KeyView;
  readonly theme?: Theme;
}

export const SIZES = [96, 144] as const;

const meter = (level: number, peak = level + 6, clip = false): MeterLevel => ({
  level,
  peak,
  clip,
});

const mic9: ChannelKey = {
  kind: 'channel',
  label: 'MIC 9',
  name: 'Vocal',
  color: 1,
  value: { kind: 'gain', db: 42, caption: 'Gain' },
  meter: { left: meter(-16, -9) },
  badges: { phantom: true, phase: false, instrument: false, autoSet: false, stereo: false },
};

const kick: ChannelKey = {
  kind: 'channel',
  label: 'MIC 10',
  name: 'Kick In',
  color: 6,
  value: { kind: 'gain', db: 28, caption: 'Gain' },
  meter: { left: meter(-3, 0, true), right: meter(-4, -0.5, true) },
  badges: { phantom: false, phase: true, instrument: false, autoSet: false, stereo: true },
};

const synth: ChannelKey = {
  kind: 'channel',
  label: 'AN 1/2',
  name: 'Synth',
  color: 7,
  value: { kind: 'level', db: -6.5, caption: 'Fader → Main' },
  meter: { left: meter(-22, -14), right: meter(-20, -13) },
  badges: { phase: false, stereo: true },
};

const channel = (base: ChannelKey, over: Partial<ChannelKey>): ChannelKey => ({ ...base, ...over });

const main: OutputKey = {
  kind: 'output',
  role: 'main',
  label: 'AN 1/2',
  name: 'Monitors',
  volume: -18.5,
  meter: { left: meter(-20, -12), right: meter(-21, -13) },
  monitor: { dim: false, mono: false, speakerB: false, external: false, talkback: false },
};

const phones1: OutputKey = {
  kind: 'output',
  role: 'phones',
  title: 'PHONES 1',
  label: 'PH 9/10',
  name: 'Cue Mix',
  volume: -12,
  meter: { left: meter(-24, -16), right: meter(-25, -17) },
};

const CHANNEL = 'Channel key: full style';
const CHANNEL_STYLES = 'Channel key: meter and minimal styles';
const OUTPUTS = 'Main, phones and output keys';
const TOGGLES = 'Monitor and global toggles';
const FUNCTIONS = 'Snapshot, recorder, step and navigation keys';
const STATUS = 'Status key';
const CONTROLS = 'Channel Detail overlay keys';

export const CASES: readonly Case[] = [
  // --- channel, full ---
  { name: 'channel-full', title: 'Normal', group: CHANNEL, view: mic9 },
  {
    name: 'channel-full-muted',
    title: 'Muted',
    group: CHANNEL,
    view: channel(mic9, { muted: true }),
  },
  {
    name: 'channel-full-solo',
    title: 'Solo',
    group: CHANNEL,
    view: channel(mic9, { soloed: true, meter: { left: meter(-5, -2) } }),
  },
  {
    name: 'channel-full-muted-solo',
    title: 'Muted and solo',
    group: CHANNEL,
    view: channel(mic9, { muted: true, soloed: true }),
  },
  {
    name: 'channel-full-pending',
    title: 'Pending',
    group: CHANNEL,
    view: channel(mic9, { pending: true }),
  },
  {
    name: 'channel-full-offline',
    title: 'Offline',
    group: CHANNEL,
    view: channel(mic9, { offline: true }),
  },
  { name: 'channel-full-clip', title: 'Clip, phase, stereo', group: CHANNEL, view: kick },
  { name: 'channel-full-fader', title: 'Line pair, fader', group: CHANNEL, view: synth },
  {
    name: 'channel-full-send-off',
    title: 'Send off',
    group: CHANNEL,
    view: channel(synth, { value: { kind: 'level', db: -Infinity, caption: '→ PH 1' } }),
  },
  {
    name: 'channel-full-long-name',
    title: 'Long name, all badges',
    group: CHANNEL,
    view: channel(mic9, {
      label: 'MIC 12',
      name: 'Background Vocals Left',
      color: 3,
      badges: { phantom: true, phase: true, instrument: true, autoSet: true },
    }),
  },
  {
    name: 'channel-full-no-name',
    title: 'No name, playback',
    group: CHANNEL,
    view: {
      kind: 'channel',
      label: 'ADAT 3/4',
      name: '',
      value: { kind: 'level', db: 0, caption: 'Fader' },
      meter: { left: meter(-100), right: meter(-100) },
      badges: { stereo: true },
    },
  },
  {
    name: 'channel-full-unknown',
    title: 'Not synced yet',
    group: CHANNEL,
    view: channel(mic9, {
      value: { kind: 'gain', db: undefined, caption: 'Gain' },
      meter: undefined,
    }),
  },
  {
    name: 'channel-full-high-contrast',
    title: 'High contrast',
    group: CHANNEL,
    view: mic9,
    theme: HIGH_CONTRAST,
  },
  {
    name: 'channel-full-high-contrast-muted-solo',
    title: 'High contrast, muted, solo',
    group: CHANNEL,
    view: channel(mic9, { muted: true, soloed: true }),
    theme: HIGH_CONTRAST,
  },

  // --- channel, meter and minimal ---
  {
    name: 'channel-meter',
    title: 'Meter',
    group: CHANNEL_STYLES,
    view: channel(kick, {
      style: 'meter',
      meter: { left: meter(-9, -1.2), right: meter(-10, -2.5) },
    }),
  },
  {
    name: 'channel-meter-clip',
    title: 'Meter, clip',
    group: CHANNEL_STYLES,
    view: channel(kick, { style: 'meter' }),
  },
  {
    name: 'channel-meter-mono-muted',
    title: 'Meter, mono, muted',
    group: CHANNEL_STYLES,
    view: channel(mic9, { style: 'meter', muted: true }),
  },
  {
    name: 'channel-meter-offline',
    title: 'Meter, offline',
    group: CHANNEL_STYLES,
    view: channel(kick, { style: 'meter', offline: true }),
  },
  {
    name: 'channel-minimal',
    title: 'Minimal, signal',
    group: CHANNEL_STYLES,
    view: channel(mic9, { style: 'minimal' }),
  },
  {
    name: 'channel-minimal-muted',
    title: 'Minimal, muted',
    group: CHANNEL_STYLES,
    view: channel(mic9, { style: 'minimal', muted: true }),
  },
  {
    name: 'channel-minimal-solo-pending',
    title: 'Minimal, solo, pending',
    group: CHANNEL_STYLES,
    view: channel(synth, {
      style: 'minimal',
      soloed: true,
      pending: true,
      meter: { left: meter(-70), right: meter(-70) },
    }),
  },
  {
    name: 'channel-minimal-long-name',
    title: 'Minimal, long name',
    group: CHANNEL_STYLES,
    view: channel(mic9, { style: 'minimal', name: 'Background Vocals Left' }),
  },
  {
    name: 'channel-minimal-offline',
    title: 'Minimal, offline',
    group: CHANNEL_STYLES,
    view: channel(mic9, { style: 'minimal', offline: true }),
  },

  // --- outputs ---
  { name: 'output-main', title: 'Main', group: OUTPUTS, view: main },
  {
    name: 'output-main-dim',
    title: 'Main, dim and mono',
    group: OUTPUTS,
    view: {
      ...main,
      volume: -38.5,
      monitor: { dim: true, mono: true },
      meter: { left: meter(-40), right: meter(-41) },
    },
  },
  {
    name: 'output-main-muted',
    title: 'Main, muted',
    group: OUTPUTS,
    view: { ...main, muted: true },
  },
  {
    name: 'output-main-pending',
    title: 'Main, pending',
    group: OUTPUTS,
    view: { ...main, volume: -17.5, pending: true },
  },
  { name: 'output-phones', title: 'Phones', group: OUTPUTS, view: phones1 },
  {
    name: 'output-phones-muted',
    title: 'Phones, muted',
    group: OUTPUTS,
    view: {
      ...phones1,
      title: 'PHONES 2',
      label: 'PH 11/12',
      name: 'Artist',
      volume: -20,
      muted: true,
    },
  },
  {
    name: 'output-line',
    title: 'Output',
    group: OUTPUTS,
    view: {
      kind: 'output',
      role: 'output',
      label: 'AN 3/4',
      name: 'NS10',
      volume: -10,
      meter: { left: meter(-100), right: meter(-100) },
    },
  },
  { name: 'output-offline', title: 'Offline', group: OUTPUTS, view: { ...main, offline: true } },

  // --- toggles ---
  {
    name: 'toggle-dim-on',
    title: 'Dim on',
    group: TOGGLES,
    view: { kind: 'toggle', function: 'dim', on: true, caption: `${MINUS}20 dB` },
  },
  {
    name: 'toggle-dim-off',
    title: 'Dim off',
    group: TOGGLES,
    view: { kind: 'toggle', function: 'dim', on: false, caption: `${MINUS}20 dB` },
  },
  {
    name: 'toggle-mono-on',
    title: 'Mono on',
    group: TOGGLES,
    view: { kind: 'toggle', function: 'mono', on: true, caption: 'Main out' },
  },
  {
    name: 'toggle-talkback',
    title: 'Talkback, held',
    group: TOGGLES,
    view: { kind: 'toggle', function: 'talkback', on: true, caption: 'hold to talk' },
  },
  {
    name: 'toggle-speaker-b',
    title: 'Speaker B off',
    group: TOGGLES,
    view: { kind: 'toggle', function: 'speakerB', on: false },
  },
  {
    name: 'toggle-global-mute',
    title: 'Global mute on',
    group: TOGGLES,
    view: { kind: 'toggle', function: 'globalMute', on: true, caption: 'all channels' },
  },
  {
    name: 'toggle-global-solo',
    title: 'Global solo on',
    group: TOGGLES,
    view: { kind: 'toggle', function: 'globalSolo', on: true, caption: '2 soloed' },
  },
  {
    name: 'toggle-pending',
    title: 'Pending',
    group: TOGGLES,
    view: { kind: 'toggle', function: 'mono', on: true, pending: true, caption: 'Main out' },
  },
  {
    name: 'toggle-unknown',
    title: 'Not synced yet',
    group: TOGGLES,
    view: { kind: 'toggle', function: 'external', on: undefined },
  },
  {
    name: 'toggle-offline',
    title: 'Offline',
    group: TOGGLES,
    view: { kind: 'toggle', function: 'dim', on: true, offline: true },
  },

  // --- snapshot, recorder, step, navigation ---
  {
    name: 'snapshot',
    title: 'Snapshot',
    group: FUNCTIONS,
    view: { kind: 'snapshot', n: 3, name: 'Mixdown', state: 'inactive' },
  },
  {
    name: 'snapshot-active',
    title: 'Snapshot, loaded',
    group: FUNCTIONS,
    view: { kind: 'snapshot', n: 2, name: 'Tracking', state: 'active' },
  },
  {
    name: 'snapshot-modified',
    title: 'Loaded, edited',
    group: FUNCTIONS,
    view: { kind: 'snapshot', n: 2, name: 'Tracking', state: 'modified' },
  },
  {
    name: 'snapshot-no-name',
    title: 'No name',
    group: FUNCTIONS,
    view: { kind: 'snapshot', n: 5, state: 'inactive' },
  },
  {
    name: 'snapshot-confirm-save',
    title: 'Save armed',
    group: FUNCTIONS,
    view: { kind: 'snapshot', n: 2, name: 'Tracking', state: 'active', confirmSave: true },
  },
  {
    name: 'recorder-stopped',
    title: 'Recorder stopped',
    group: FUNCTIONS,
    view: { kind: 'recorder', state: 'stopped', time: 0 },
  },
  {
    name: 'recorder-recording',
    title: 'Recording',
    group: FUNCTIONS,
    view: { kind: 'recorder', state: 'recording', time: 754 },
  },
  {
    name: 'recorder-playing',
    title: 'Playing',
    group: FUNCTIONS,
    view: { kind: 'recorder', state: 'playing', time: 3723 },
  },
  {
    name: 'recorder-not-ready',
    title: 'Not ready',
    group: FUNCTIONS,
    view: { kind: 'recorder', state: 'notReady' },
  },
  {
    name: 'recorder-confirm',
    title: 'Record armed',
    group: FUNCTIONS,
    view: { kind: 'recorder', state: 'stopped', confirmRecord: true },
  },
  {
    name: 'step-up',
    title: 'Volume up',
    group: FUNCTIONS,
    view: { kind: 'step', direction: 'up', target: 'Main', db: -18.5 },
  },
  {
    name: 'step-down-held',
    title: 'Volume down, held',
    group: FUNCTIONS,
    view: { kind: 'step', direction: 'down', target: 'Phones 1', db: -14, held: true },
  },
  {
    name: 'step-at-limit',
    title: 'At the limit',
    group: FUNCTIONS,
    view: { kind: 'step', direction: 'up', target: 'Main', db: 6, atLimit: true },
  },
  {
    name: 'bank-next',
    title: 'Bank',
    group: FUNCTIONS,
    view: { kind: 'bank', direction: 'next', row: 'Inputs', first: 9, last: 16, total: 94 },
  },
  {
    name: 'bank-prev-end',
    title: 'Bank, at the start',
    group: FUNCTIONS,
    view: {
      kind: 'bank',
      direction: 'prev',
      row: 'Inputs',
      first: 1,
      last: 8,
      total: 94,
      atEnd: true,
    },
  },
  {
    name: 'page',
    title: 'Page',
    group: FUNCTIONS,
    view: { kind: 'page', name: 'Inputs', index: 1, count: 4 },
  },

  // --- Channel Detail overlay ---
  {
    name: 'control-switch-on',
    title: 'Switch on (48V)',
    group: CONTROLS,
    view: { kind: 'control', title: 'Phantom', word: '48V', switch: true, color: 'phantom' },
  },
  {
    name: 'control-switch-off',
    title: 'Switch off (phase)',
    group: CONTROLS,
    view: { kind: 'control', title: 'Phase', word: 'Ø', switch: false },
  },
  {
    name: 'control-switch-unknown',
    title: 'Switch, not read yet',
    group: CONTROLS,
    view: { kind: 'control', title: 'EQ', word: 'EQ', switch: 'unknown' },
  },
  {
    name: 'control-switch-pending',
    title: 'Switch, pending',
    group: CONTROLS,
    view: { kind: 'control', title: 'Low cut', word: '80 Hz', switch: true, pending: true },
  },
  {
    name: 'control-arrow',
    title: 'Gain +',
    group: CONTROLS,
    view: { kind: 'control', title: 'Gain', arrow: 'up', word: '+42 dB' },
  },
  {
    name: 'control-arrow-held',
    title: 'Fader −, held',
    group: CONTROLS,
    view: { kind: 'control', title: 'Fader', arrow: 'down', word: `${MINUS}6.0`, lit: true },
  },
  {
    name: 'control-arrow-limit',
    title: 'Pan at the limit',
    group: CONTROLS,
    view: { kind: 'control', title: 'Pan PH 9/10', arrow: 'right', word: 'R100', atLimit: true },
  },
  {
    name: 'control-send-selected',
    title: 'Send, selected',
    group: CONTROLS,
    view: {
      kind: 'control',
      title: '→ PH 9/10',
      word: `${MINUS}3.0`,
      caption: 'Phones 1',
      lit: true,
    },
  },
  {
    name: 'control-back',
    title: 'Back',
    group: CONTROLS,
    view: { kind: 'control', title: 'Detail', arrow: 'left', word: 'BACK' },
  },
  {
    name: 'control-clear-clipped',
    title: 'Clear clip, clipped',
    group: CONTROLS,
    view: {
      kind: 'control',
      title: 'Meter',
      word: 'CLEAR',
      caption: 'clipped',
      lit: true,
      color: 'record',
    },
  },
  {
    name: 'control-offline',
    title: 'Offline',
    group: CONTROLS,
    view: { kind: 'control', title: 'Gain', arrow: 'up', word: '+42 dB', offline: true },
  },

  // --- status ---
  {
    name: 'status-live',
    title: 'Live',
    group: STATUS,
    view: {
      kind: 'status',
      link: 'live',
      device: 'Fireface UFX III',
      sampleRate: 48000,
      clock: 'locked',
      dsp: 0.23,
      beat: true,
    },
  },
  {
    name: 'status-live-minimal',
    title: 'Live, no details',
    group: STATUS,
    view: { kind: 'status', link: 'live', device: 'Fireface UFX III', beat: false },
  },
  {
    name: 'status-syncing',
    title: 'Syncing',
    group: STATUS,
    view: { kind: 'status', link: 'syncing', device: 'Fireface UFX III' },
  },
  {
    name: 'status-probing',
    title: 'Connecting',
    group: STATUS,
    view: { kind: 'status', link: 'probing' },
  },
  {
    name: 'status-stale',
    title: 'No reply',
    group: STATUS,
    view: {
      kind: 'status',
      link: 'stale',
      device: 'Fireface UFX III',
      message: 'No reply on port 9002 for 3 s',
    },
  },
  {
    name: 'status-idle',
    title: 'Off',
    group: STATUS,
    view: { kind: 'status', link: 'idle', message: 'Port 9002 in use' },
  },
];
