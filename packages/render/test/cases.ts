// The golden cases: every key type in each state worth looking at. Each case is rendered at
// 96 and 144 px into test/goldens/ and laid out on renders/contact-sheet.png.

import {
  HIGH_CONTRAST,
  type ChannelKey,
  type KeyView,
  type MeterLevel,
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

const CHANNEL = 'Channel key: full style';
const CHANNEL_STYLES = 'Channel key: meter and minimal styles';

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
];
