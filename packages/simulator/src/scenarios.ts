// Ready-made mixer layouts and meter signal sets.
//
// Layouts:
// - studio: a small session on a UFX III, a few strips per bus like a real TotalMix window
//   (the default; replies stay small and fast).
// - full: every channel visible and paired in stereo, the worst case for sync and meters.
// - band: a band tracking session that fills both channel rows of the Console, for the
//   screenshots in the README and on the website (npm run screenshots).
//
// Meter sets give signals to the visible strips of whatever layout is loaded.

import type { Bus } from '@faderlight/model';
import type { Signal } from './meters.ts';
import { SimMixer, type SimMixerOptions } from './mixer.ts';

export const LAYOUTS = ['studio', 'full', 'band'] as const;
export type LayoutName = (typeof LAYOUTS)[number];

interface StripSpec {
  readonly index: number;
  readonly stereo?: boolean;
  readonly name: string;
  readonly values?: Readonly<Record<string, number>>;
}

const STUDIO: Readonly<Record<Bus, readonly StripSpec[]>> = {
  input: [
    { index: 0, stereo: true, name: 'Synth', values: { gain: 4, color: 5 } },
    { index: 8, name: 'Vocal', values: { gain: 42, '48v': 1, color: 3 } },
    { index: 9, name: 'Guitar', values: { gain: 18, instrument: 1, color: 6 } },
    { index: 10, stereo: true, name: 'Room', values: { gain: 30, color: 3 } },
  ],
  playback: [
    { index: 0, stereo: true, name: 'DAW' },
    { index: 2, stereo: true, name: 'Browser' },
  ],
  output: [
    { index: 0, stereo: true, name: 'Main', values: { volume: -20, reflevel: 1 } },
    { index: 8, stereo: true, name: 'Phones 1', values: { volume: -12 } },
    { index: 10, stereo: true, name: 'Phones 2', values: { volume: -12 } },
  ],
};

const STUDIO_SETTINGS: Readonly<Record<string, number>> = {
  '/controlroom/mainout': 0,
  '/controlroom/phones1': 8,
  '/controlroom/phones2': 10,
};

/** Route faders in dB: [source, source index, output, fader]. */
const STUDIO_ROUTES: readonly Route[] = [
  ['in', 0, 0, -10],
  ['in', 8, 0, -6],
  ['in', 9, 0, -6],
  ['in', 10, 0, -12],
  ['in', 8, 8, -3],
  ['in', 9, 8, -8],
  ['in', 8, 10, -6],
  ['pb', 0, 8, 0],
  ['pb', 0, 10, 0],
  ['pb', 2, 0, -6],
];

type Route = readonly ['in' | 'pb', number, number, number];

/** A mixer with only the given strips visible, named and set, and the given routes. */
function laidOut(
  options: Omit<SimMixerOptions, 'hidden'>,
  strips: Readonly<Record<Bus, readonly StripSpec[]>>,
  routes: readonly Route[],
): SimMixer {
  const mixer = new SimMixer({ ...options, hidden: true });
  for (const bus of ['input', 'playback', 'output'] as const) {
    for (const strip of strips[bus]) {
      mixer.setVisible(bus, strip.index, true);
      if (strip.stereo === true) mixer.setStereo(bus, strip.index, true);
      const prefix = `/${bus}/${String(strip.index)}/`;
      mixer.setValue(`${prefix}name`, strip.name);
      for (const [field, v] of Object.entries(strip.values ?? {})) {
        mixer.setValue(prefix + field, v);
      }
    }
  }
  for (const [address, v] of Object.entries(STUDIO_SETTINGS)) mixer.setValue(address, v);
  for (const [source, index, output, fader] of routes) {
    mixer.setValue(`/mix/${source}/${String(index)}/${String(output)}/fader`, fader);
  }
  return mixer;
}

/**
 * The default layout: Synth (AN 1/2), Vocal (Mic 9, 48V), Guitar (Mic 10, Inst) and Room
 * (Mic 11/12) in; DAW and Browser playback; Main on AN 1/2 and two phones out. Snapshot 1 is
 * this state; snapshot 2 ("tracking") mutes Synth and Browser and turns the vocal up in Phones 1.
 */
export function studioMixer(options: Omit<SimMixerOptions, 'hidden'> = {}): SimMixer {
  const mixer = laidOut(options, STUDIO, STUDIO_ROUTES);
  for (let k = 1; k <= 8; k++) mixer.saveSnapshot(k);
  mixer.setValue('/input/0/mute', 1);
  mixer.setValue('/playback/2/mute', 1);
  mixer.setValue('/mix/in/8/8/fader', 0);
  mixer.saveSnapshot(2);
  mixer.loadSnapshot(1);
  return mixer;
}

/** Every channel visible, stereo pairs throughout, default names ("AN 1/2"). */
export function fullMixer(options: Omit<SimMixerOptions, 'hidden'> = {}): SimMixer {
  const mixer = new SimMixer({ ...options, hidden: false });
  for (const bus of ['input', 'playback', 'output'] as const) {
    for (let n = 0; n + 1 < mixer.channelCount(bus); n += 2) mixer.setStereo(bus, n, true);
  }
  mixer.setValue('/controlroom/mainout', 0);
  for (let k = 1; k <= 8; k++) mixer.saveSnapshot(k);
  mixer.loadSnapshot(1);
  return mixer;
}

const BAND: Readonly<Record<Bus, readonly StripSpec[]>> = {
  input: [
    { index: 0, stereo: true, name: 'Keys', values: { gain: 2, color: 6 } },
    { index: 2, stereo: true, name: 'Synth', values: { gain: 0, color: 5 } },
    { index: 4, name: 'Bass', values: { gain: 3, color: 5 } },
    { index: 8, name: 'Vocal', values: { gain: 42, '48v': 1, color: 3 } },
    { index: 9, name: 'Guitar', values: { gain: 18, instrument: 1, color: 4 } },
    { index: 10, name: 'Kick', values: { gain: 36, color: 4 } },
    { index: 11, name: 'Snare', values: { gain: 30, '48v': 1, color: 4 } },
    { index: 14, stereo: true, name: 'Overheads', values: { color: 4 } },
    { index: 16, stereo: true, name: 'Room', values: { color: 4 } },
  ],
  playback: [
    { index: 0, stereo: true, name: 'DAW' },
    { index: 2, name: 'Click' },
    { index: 4, stereo: true, name: 'Reference' },
    { index: 6, stereo: true, name: 'Browser' },
  ],
  output: [
    { index: 0, stereo: true, name: 'Main', values: { volume: -18, reflevel: 1 } },
    { index: 2, stereo: true, name: 'Speakers B', values: { volume: -24 } },
    { index: 8, stereo: true, name: 'Phones 1', values: { volume: -10 } },
    { index: 10, stereo: true, name: 'Phones 2', values: { volume: -14 } },
    { index: 12, stereo: true, name: 'Cue 3', values: { volume: -8 } },
    { index: 14, stereo: true, name: 'Stream', values: { volume: -6 } },
  ],
};

const BAND_ROUTES: readonly Route[] = [
  ['in', 0, 0, -8],
  ['in', 2, 0, -12],
  ['in', 4, 0, -4],
  ['in', 8, 0, -3],
  ['in', 9, 0, -6],
  ['in', 10, 0, -5],
  ['in', 11, 0, -7],
  ['in', 14, 0, -10],
  ['in', 16, 0, -14],
  ['in', 8, 8, -2],
  ['in', 10, 8, -6],
  ['in', 8, 10, 0],
  ['pb', 0, 0, 0],
  ['pb', 0, 8, -3],
  ['pb', 2, 8, -6],
  ['pb', 0, 10, -3],
  ['pb', 4, 0, -6],
];

/**
 * A band tracking session on a UFX III: keys, synth and bass on the line inputs, vocal,
 * guitar, kick and snare on the front preamps, overheads and room over ADAT; DAW, click,
 * reference and browser playback; Main, Speakers B, both phones, a third cue mix and a stream
 * mix out. Enough strips to fill both channel rows of the Console. The synth is muted.
 */
export function bandMixer(options: Omit<SimMixerOptions, 'hidden'> = {}): SimMixer {
  const mixer = laidOut(options, BAND, BAND_ROUTES);
  mixer.setValue('/input/2/mute', 1);
  for (let k = 1; k <= 8; k++) mixer.saveSnapshot(k);
  mixer.loadSnapshot(1);
  return mixer;
}

export function layoutMixer(
  name: LayoutName,
  options: Omit<SimMixerOptions, 'hidden'> = {},
): SimMixer {
  switch (name) {
    case 'full':
      return fullMixer(options);
    case 'band':
      return bandMixer(options);
    case 'studio':
      return studioMixer(options);
  }
}

// --- meter sets -------------------------------------------------------------------------

export const METER_SETS = ['studio', 'band', 'quiet', 'noise', 'clip', 'sweep'] as const;
export type MeterSetName = (typeof METER_SETS)[number];

const VOICE: Signal = { type: 'noise', db: -18, spreadDb: 6 };
const DRUMS: Signal = { type: 'drums', bpm: 120, peakDb: -6, clipEvery: 8 };
const SWEEP: Signal = { type: 'sweep', fromDb: -60, toDb: -3, periodMs: 8000 };
const QUIET: Signal = { type: 'noise', db: -40, spreadDb: 4 };
const MUSIC: Signal = { type: 'noise', db: -14, spreadDb: 4 };

function forStrips(
  mixer: SimMixer,
  bus: 'input' | 'playback',
  pick: (position: number) => Signal | undefined,
): [string, Signal][] {
  const wireBus = bus === 'input' ? 'in' : 'pb';
  return mixer.strips(bus).flatMap((n, position) => {
    const signal = pick(position);
    if (!signal) return [];
    const sides = mixer.isRight(bus, n + 1) ? [n, n + 1] : [n];
    return sides.map((c): [string, Signal] => [`${wireBus}/${String(c)}`, signal]);
  });
}

/**
 * Signals for the visible strips of a mixer:
 * - studio: inputs take turns with voice, drums (an over every 8th hit), a level sweep and
 *   quiet room noise; the first playback strip plays music.
 * - quiet: silence everywhere (meters only move after a start frame).
 * - noise: noise at −18 dBFS on every input and playback strip.
 * - clip: drums that go over every 4th hit on every input.
 * - sweep: a level sweep on every input and playback strip.
 * - band: what a band plays, by strip name: drums on Kick, Snare, Overheads and Room (the
 *   snare goes over now and then), voice on Vocal, Guitar and Bass, music on the rest.
 */
export function meterSignals(name: MeterSetName, mixer: SimMixer): Map<string, Signal> {
  switch (name) {
    case 'quiet':
      return new Map();
    case 'noise':
      return new Map([
        ...forStrips(mixer, 'input', () => ({ type: 'noise', db: -18 })),
        ...forStrips(mixer, 'playback', () => ({ type: 'noise', db: -18 })),
      ]);
    case 'clip':
      return new Map(
        forStrips(mixer, 'input', () => ({ type: 'drums', bpm: 120, peakDb: -3, clipEvery: 4 })),
      );
    case 'sweep':
      return new Map([
        ...forStrips(mixer, 'input', () => SWEEP),
        ...forStrips(mixer, 'playback', () => SWEEP),
      ]);
    case 'band': {
      const drums = new Set(['Kick', 'Snare', 'Overheads', 'Room']);
      const voices = new Set(['Vocal', 'Guitar', 'Bass']);
      const signal = (bus: 'input' | 'playback', position: number): Signal => {
        const n = mixer.strips(bus)[position];
        const name = n === undefined ? '' : String(mixer.get(`/${bus}/${String(n)}/name`) ?? '');
        if (name === 'Snare') return { type: 'drums', bpm: 120, peakDb: -2, clipEvery: 6 };
        if (drums.has(name)) return DRUMS;
        return voices.has(name) ? VOICE : MUSIC;
      };
      return new Map([
        ...forStrips(mixer, 'input', (i) => signal('input', i)),
        ...forStrips(mixer, 'playback', (i) => (i === 1 ? QUIET : signal('playback', i))),
      ]);
    }
    case 'studio': {
      const turns = [VOICE, DRUMS, SWEEP, QUIET];
      return new Map([
        ...forStrips(mixer, 'input', (i) => turns[i % turns.length]),
        ...forStrips(mixer, 'playback', (i) => (i === 0 ? MUSIC : undefined)),
      ]);
    }
  }
}
