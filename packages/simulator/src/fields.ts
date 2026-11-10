// What TotalMix sends for each channel, route and setting: wire names in the order TotalMix sends
// them, value types and default values. Every order and every "only on" rule below was read off
// the baseline capture (docs/protocol/global-osc.md §2 and §7); defaults are the values most
// channels showed there.

import type { Bus } from '@faderlight/model';

/** switch: 0 or 1. number: a float32. text: a string (names). */
export type FieldType = 'switch' | 'number' | 'text';

/**
 * Hardware a channel must have for a field to exist: `gain` an adjustable preamp or trim,
 * `mic` a mic preamp (48V, Inst, AutoSet), `refLevel` a switchable reference level.
 */
export type Feature = 'gain' | 'mic' | 'refLevel';

export interface FieldDef {
  /** Wire name after `/{bus}/{n}/`, e.g. `eq/band1freq`. */
  readonly name: string;
  readonly type: FieldType;
  /**
   * Per side: sent for both channels of a stereo strip (the right one at its own index).
   * Otherwise the field belongs to the strip and is only sent at its left index.
   */
  readonly side: boolean;
  readonly feature?: Feature;
  /** Default value; undefined for names, which default to the channel's label. */
  readonly initial: number | undefined;
}

const sw = (name: string, initial = 0): FieldDef => ({
  name,
  type: 'switch',
  side: false,
  initial,
});
const num = (name: string, initial: number): FieldDef => ({
  name,
  type: 'number',
  side: false,
  initial,
});
const sideNum = (name: string, initial: number): FieldDef => ({
  ...num(name, initial),
  side: true,
});
const gated = (def: FieldDef, feature: Feature): FieldDef => ({ ...def, feature });
const NAME: FieldDef = { name: 'name', type: 'text', side: false, initial: undefined };

/** Low cut, EQ, Auto Level and dynamics, in TotalMix's (interleaved) order. Inputs and outputs. */
const PROCESSING: readonly FieldDef[] = [
  sw('lowcut/enable'),
  sw('eq/enable'),
  num('lowcut/slope', 1),
  num('lowcut/freq', 20),
  num('eq/band1freq', 80),
  num('eq/band1q', 1),
  num('eq/band1gain', 0),
  num('eq/band2freq', 1000),
  num('eq/band2q', 1),
  num('eq/band2gain', 0),
  num('eq/band3freq', 5000),
  num('eq/band3q', 1),
  num('eq/band3gain', 0),
  num('eq/band1type', 1),
  num('eq/band3type', 1),
  sw('autolevel/enable'),
  sw('dynamics/enable'),
  num('autolevel/maxgain', 6),
  num('autolevel/headroom', 6),
  num('autolevel/risetime', 5),
  num('dynamics/gain', 0),
  num('dynamics/attack', 10),
  num('dynamics/release', 300),
  num('dynamics/compthres', -30),
  num('dynamics/compratio', 1),
  num('dynamics/expthres', -60),
  num('dynamics/expratio', 1),
];

const ROOM_EQ_FREQS = [50, 100, 150, 200, 250, 300, 400, 600, 800];

/** Room EQ bands, per side, after `delay`. */
const ROOM_EQ_BANDS: readonly FieldDef[] = [
  ...ROOM_EQ_FREQS.flatMap((freq, i) => {
    const band = `roomeq/band${String(i + 1)}`;
    const q = i === 0 || i === 8 ? 0.7 : 5;
    return [sideNum(`${band}freq`, freq), sideNum(`${band}q`, q), sideNum(`${band}gain`, 0)];
  }),
  sideNum('roomeq/band1type', 1),
  sideNum('roomeq/band8type', 0),
  sideNum('roomeq/band9type', 1),
];

/** Every field of a channel strip per bus, in the order of a `/sendchan` reply. */
export const CHANNEL_FIELDS: Readonly<Record<Bus, readonly FieldDef[]>> = {
  input: [
    sw('stereo'),
    NAME,
    sw('mute'),
    gated(num('reflevel', 0), 'refLevel'),
    gated(sideNum('gain', 0), 'gain'),
    gated(sw('autoset'), 'mic'),
    { ...sw('phase'), side: true },
    sw('msproc'),
    num('width', 1),
    num('fxsend', -300),
    gated(sw('48v'), 'mic'),
    gated(sw('instrument'), 'mic'),
    sw('record'),
    sideNum('playchan', 0),
    ...PROCESSING,
    num('color', 1),
  ],
  playback: [
    sw('stereo'),
    NAME,
    sw('mute'),
    { ...sw('phase'), side: true },
    sw('msproc'),
    num('width', 1),
    num('fxsend', -300),
    num('color', 1),
  ],
  output: [
    num('volume', 0),
    num('balpan', 0),
    num('groupflags', 0),
    sw('stereo'),
    NAME,
    sw('mute'),
    num('fxreturn', -65),
    gated(num('reflevel', 0), 'refLevel'),
    sideNum('gain', 0),
    { ...sw('phase'), side: true },
    sw('loopback'),
    sw('record'),
    sideNum('playchan', 0),
    sw('talkbacksel'),
    ...PROCESSING,
    num('color', 1),
    num('crossfeed', 0),
    sw('roomeq/enable'),
    sideNum('delay', 0),
    ...ROOM_EQ_BANDS,
  ],
};

const index = (defs: readonly FieldDef[]): ReadonlyMap<string, FieldDef> =>
  new Map(defs.map((d) => [d.name, d]));

export const CHANNEL_FIELD_INDEX: Readonly<Record<Bus, ReadonlyMap<string, FieldDef>>> = {
  input: index(CHANNEL_FIELDS.input),
  playback: index(CHANNEL_FIELDS.playback),
  output: index(CHANNEL_FIELDS.output),
};

/**
 * Fields a snapshot does not restore. Names and the stereo setting belong to the layout; whether
 * TotalMix keeps them out of snapshots is not captured yet.
 */
export const NOT_IN_SNAPSHOT: ReadonlySet<string> = new Set(['name', 'stereo']);

// --- matrix -----------------------------------------------------------------------------

/** Fields of one matrix route, `/mix/{in|pb}/{src}/{out}/...`, in TotalMix's order. */
export const ROUTE_FIELDS: readonly FieldDef[] = [
  num('fader', -300),
  num('balpan', 0),
  num('groupflags', 0),
  sw('solo'),
];

export const ROUTE_FIELD_INDEX: ReadonlyMap<string, FieldDef> = index(ROUTE_FIELDS);

/** Wire value for off on faders and sends (−∞). */
export const OFF_DB = -300;

/**
 * Lowest fader value above off. `/sendall 2` left out a route at −65 like the routes at −300,
 * so a route counts as on above this value (docs/protocol/global-osc.md §6, inferred).
 */
export const FADER_MIN_DB = -65;

// --- settings ---------------------------------------------------------------------------

/** Global settings, in the order of a `/sendsettings` reply. Addresses are complete. */
export const SETTINGS: readonly FieldDef[] = [
  sw('/globalmute'),
  sw('/globalsolo'),
  ...['mutegroup', 'sologroup', 'fadergroup'].flatMap((g) =>
    [1, 2, 3, 4].map((k) => sw(`/${g}/${String(k)}`)),
  ),
  sw('/controlroom/linkab'),
  num('/controlroom/mainout', 0),
  num('/controlroom/mainoutb', -1),
  num('/controlroom/phones1', -1),
  num('/controlroom/phones2', -1),
  num('/controlroom/phones3', -1),
  num('/controlroom/phones4', -1),
  sw('/controlroom/speakerb'),
  num('/controlroom/cuechan', -1),
  sw('/controlroom/dim'),
  num('/controlroom/dimreduction', -20),
  num('/controlroom/recallvolume', -20),
  sw('/controlroom/mutefx'),
  sw('/controlroom/mainmono'),
  sw('/controlroom/externalin'),
  num('/controlroom/extinchannel', -1),
  num('/controlroom/extingain', -3),
  sw('/controlroom/talkback'),
  num('/controlroom/talkchannel', -1),
  sw('/reverb/enable'),
  num('/reverb/type', 2),
  num('/reverb/predelay', 20),
  num('/reverb/lowcut', 20),
  num('/reverb/highcut', 18000),
  num('/reverb/attack', 100),
  num('/reverb/hold', 80),
  num('/reverb/release', 200),
  num('/reverb/roomscale', 1),
  num('/reverb/time', 3),
  num('/reverb/highdamp', 18000),
  num('/reverb/smooth', 100),
  num('/reverb/volume', -3),
  num('/reverb/width', 0.6),
  sw('/echo/enable'),
  num('/echo/type', 0),
  num('/echo/delay', 0.6),
  num('/echo/feedback', 20),
  num('/echo/highcut', 0),
  num('/echo/volume', -3),
  num('/echo/width', 0.6),
];

export const SETTINGS_INDEX: ReadonlyMap<string, FieldDef> = index(SETTINGS);

export const SNAPSHOT_COUNT = 8;

/** `/snapshot/load/{k}` values. */
export const SNAPSHOT_INACTIVE = 0;
export const SNAPSHOT_ACTIVE = 2;
export const SNAPSHOT_MODIFIED = 3;

/** Normalises a written number for a field type: switches become 0 or 1, numbers float32. */
export function normalise(type: FieldType, n: number): number {
  return type === 'switch' ? (n >= 0.5 ? 1 : 0) : Math.fround(n);
}
