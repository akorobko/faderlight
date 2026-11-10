// The mixer vocabulary: what can be addressed, and how each value is represented.
//
// Protocol-agnostic: names describe the mixer, not the wire. The TotalMix adaptor
// (packages/totalmix) maps OSC addresses to these targets and back. Indices are 0-based
// physical channels; a stereo strip is addressed by its left index.

export type Bus = 'input' | 'playback' | 'output';
export type SourceBus = 'input' | 'playback';

export const BUSES: readonly Bus[] = ['input', 'playback', 'output'];

/**
 * How a value is represented:
 * - switch: boolean
 * - level: dB, -Infinity means off (faders, sends, output volume)
 * - db: dB, always finite (preamp gain, EQ gain, thresholds)
 * - number: anything else numeric (frequency, Q, ratio, width, pan, enum index, colour)
 * - channel: a channel index, -1 means none
 * - text: a string
 * - snapshot: 'inactive' | 'active' | 'modified'
 */
export type ValueKind = 'switch' | 'level' | 'db' | 'number' | 'channel' | 'text' | 'snapshot';

export type Value = number | boolean | string;

export type SnapshotState = 'inactive' | 'active' | 'modified';

/** Channel index meaning "none" in `channel` values. */
export const NO_CHANNEL = -1;

// --- channel fields -------------------------------------------------------------------

/** strip: only on a strip's left index. side: on each physical channel (left and right). */
export type FieldScope = 'strip' | 'side';

export interface ChannelFieldInfo {
  readonly kind: ValueKind;
  readonly scope: FieldScope;
  /** Buses that have this field. */
  readonly buses: readonly Bus[];
}

type EqBand = 1 | 2 | 3;
type RoomEqBand = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type RoomEqTypedBand = 1 | 8 | 9;

export type ChannelField =
  | 'name'
  | 'mute'
  | 'stereo'
  | 'width'
  | 'msProc'
  | 'color'
  | 'record'
  | 'fxSend'
  | 'phantom'
  | 'instrument'
  | 'autoSet'
  | 'refLevel'
  | 'volume'
  | 'balance'
  | 'loopback'
  | 'talkbackSel'
  | 'crossfeed'
  | 'fxReturn'
  | 'groupFlags'
  | 'gain'
  | 'phase'
  | 'playChan'
  | 'delay'
  | `lowCut.${'enable' | 'freq' | 'slope'}`
  | 'eq.enable'
  | `eq.band${EqBand}.${'freq' | 'gain' | 'q'}`
  | `eq.band${1 | 3}.type`
  | `dynamics.${'enable' | 'gain' | 'attack' | 'release' | 'compThreshold' | 'compRatio' | 'expThreshold' | 'expRatio'}`
  | `autoLevel.${'enable' | 'maxGain' | 'headroom' | 'riseTime'}`
  | 'roomEq.enable'
  | `roomEq.band${RoomEqBand}.${'freq' | 'gain' | 'q'}`
  | `roomEq.band${RoomEqTypedBand}.type`;

const ALL: readonly Bus[] = BUSES;
const IN_PB: readonly Bus[] = ['input', 'playback'];
const IN_OUT: readonly Bus[] = ['input', 'output'];
const IN: readonly Bus[] = ['input'];
const OUT: readonly Bus[] = ['output'];

const strip = (kind: ValueKind, buses: readonly Bus[]): ChannelFieldInfo => ({
  kind,
  scope: 'strip',
  buses,
});
const side = (kind: ValueKind, buses: readonly Bus[]): ChannelFieldInfo => ({
  kind,
  scope: 'side',
  buses,
});

const roomEqBands = Object.fromEntries(
  [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((band) => [
    [`roomEq.band${String(band)}.freq`, side('number', OUT)],
    [`roomEq.band${String(band)}.gain`, side('db', OUT)],
    [`roomEq.band${String(band)}.q`, side('number', OUT)],
    ...(band === 1 || band === 8 || band === 9
      ? [[`roomEq.band${String(band)}.type`, side('number', OUT)]]
      : []),
  ]),
) as Record<
  `roomEq.band${RoomEqBand}.${'freq' | 'gain' | 'q'}` | `roomEq.band${RoomEqTypedBand}.type`,
  ChannelFieldInfo
>;

/** Every channel field, with its value kind, scope and buses (docs/protocol/global-osc.md §7). */
export const CHANNEL_FIELDS: Readonly<Record<ChannelField, ChannelFieldInfo>> = {
  name: strip('text', ALL),
  mute: strip('switch', ALL),
  stereo: strip('switch', ALL),
  width: strip('number', IN_PB),
  msProc: strip('switch', IN_PB),
  color: strip('number', ALL),
  record: strip('switch', IN_OUT),
  fxSend: strip('level', IN_PB),
  phantom: strip('switch', IN),
  instrument: strip('switch', IN),
  autoSet: strip('switch', IN),
  refLevel: strip('number', IN_OUT),
  volume: strip('level', OUT),
  balance: strip('number', OUT),
  loopback: strip('switch', OUT),
  talkbackSel: strip('switch', OUT),
  crossfeed: strip('number', OUT),
  fxReturn: strip('level', OUT),
  groupFlags: strip('number', OUT),
  gain: side('db', IN_OUT),
  phase: side('switch', ALL),
  playChan: side('number', IN_OUT),
  delay: side('number', OUT),
  'lowCut.enable': strip('switch', IN_OUT),
  'lowCut.freq': strip('number', IN_OUT),
  'lowCut.slope': strip('number', IN_OUT),
  'eq.enable': strip('switch', IN_OUT),
  'eq.band1.type': strip('number', IN_OUT),
  'eq.band1.freq': strip('number', IN_OUT),
  'eq.band1.gain': strip('db', IN_OUT),
  'eq.band1.q': strip('number', IN_OUT),
  'eq.band2.freq': strip('number', IN_OUT),
  'eq.band2.gain': strip('db', IN_OUT),
  'eq.band2.q': strip('number', IN_OUT),
  'eq.band3.type': strip('number', IN_OUT),
  'eq.band3.freq': strip('number', IN_OUT),
  'eq.band3.gain': strip('db', IN_OUT),
  'eq.band3.q': strip('number', IN_OUT),
  'dynamics.enable': strip('switch', IN_OUT),
  'dynamics.gain': strip('db', IN_OUT),
  'dynamics.attack': strip('number', IN_OUT),
  'dynamics.release': strip('number', IN_OUT),
  'dynamics.compThreshold': strip('db', IN_OUT),
  'dynamics.compRatio': strip('number', IN_OUT),
  'dynamics.expThreshold': strip('db', IN_OUT),
  'dynamics.expRatio': strip('number', IN_OUT),
  'autoLevel.enable': strip('switch', IN_OUT),
  'autoLevel.maxGain': strip('db', IN_OUT),
  'autoLevel.headroom': strip('db', IN_OUT),
  'autoLevel.riseTime': strip('number', IN_OUT),
  'roomEq.enable': strip('switch', OUT),
  ...roomEqBands,
};

// --- other scopes ---------------------------------------------------------------------

export type RouteField = 'fader' | 'balance' | 'solo' | 'groupFlags';

export const ROUTE_FIELDS: Readonly<Record<RouteField, ValueKind>> = {
  fader: 'level',
  balance: 'number',
  solo: 'switch',
  groupFlags: 'number',
};

export type ControlRoomField =
  | 'dim'
  | 'dimReduction'
  | 'speakerB'
  | 'linkAB'
  | 'mainMono'
  | 'muteFx'
  | 'talkback'
  | 'talkbackChannel'
  | 'externalIn'
  | 'externalInChannel'
  | 'externalInGain'
  | 'cueChannel'
  | 'mainOut'
  | 'mainOutB'
  | 'phones1'
  | 'phones2'
  | 'phones3'
  | 'phones4'
  | 'recallVolume';

export const CONTROL_ROOM_FIELDS: Readonly<Record<ControlRoomField, ValueKind>> = {
  dim: 'switch',
  dimReduction: 'level',
  speakerB: 'switch',
  linkAB: 'switch',
  mainMono: 'switch',
  muteFx: 'switch',
  talkback: 'switch',
  talkbackChannel: 'channel',
  externalIn: 'switch',
  externalInChannel: 'channel',
  externalInGain: 'db',
  cueChannel: 'channel',
  mainOut: 'channel',
  mainOutB: 'channel',
  phones1: 'channel',
  phones2: 'channel',
  phones3: 'channel',
  phones4: 'channel',
  recallVolume: 'db',
};

export type ReverbField =
  | 'enable'
  | 'type'
  | 'preDelay'
  | 'lowCut'
  | 'highCut'
  | 'attack'
  | 'hold'
  | 'release'
  | 'roomScale'
  | 'time'
  | 'highDamp'
  | 'smooth'
  | 'volume'
  | 'width';

export const REVERB_FIELDS: Readonly<Record<ReverbField, ValueKind>> = {
  enable: 'switch',
  type: 'number',
  preDelay: 'number',
  lowCut: 'number',
  highCut: 'number',
  attack: 'number',
  hold: 'number',
  release: 'number',
  roomScale: 'number',
  time: 'number',
  highDamp: 'number',
  smooth: 'number',
  volume: 'level',
  width: 'number',
};

export type EchoField = 'enable' | 'type' | 'delay' | 'feedback' | 'highCut' | 'volume' | 'width';

export const ECHO_FIELDS: Readonly<Record<EchoField, ValueKind>> = {
  enable: 'switch',
  type: 'number',
  delay: 'number',
  feedback: 'number',
  highCut: 'number',
  volume: 'level',
  width: 'number',
};

export type GroupKind = 'mute' | 'solo' | 'fader';
export type StatusField = 'device' | 'connection' | 'dsp';

/** Number of snapshots and of groups per kind. */
export const SNAPSHOT_COUNT = 8;
export const GROUP_COUNT = 4;

// --- targets --------------------------------------------------------------------------

export type Target =
  | {
      readonly scope: 'channel';
      readonly bus: Bus;
      readonly index: number;
      readonly field: ChannelField;
    }
  | {
      readonly scope: 'route';
      readonly source: SourceBus;
      readonly index: number;
      readonly output: number;
      readonly field: RouteField;
    }
  | { readonly scope: 'controlRoom'; readonly field: ControlRoomField }
  | { readonly scope: 'global'; readonly field: 'mute' | 'solo' }
  | { readonly scope: 'group'; readonly group: GroupKind; readonly n: number }
  | { readonly scope: 'snapshot'; readonly n: number }
  | { readonly scope: 'reverb'; readonly field: ReverbField }
  | { readonly scope: 'echo'; readonly field: EchoField }
  | { readonly scope: 'status'; readonly field: StatusField }
  | { readonly scope: 'durec'; readonly field: 'state' };

/** Stable string form of a target, used as the store key, e.g. `channel/input/8/mute`. */
export type Key = string;

export function keyOf(t: Target): Key {
  switch (t.scope) {
    case 'channel':
      return `channel/${t.bus}/${String(t.index)}/${t.field}`;
    case 'route':
      return `route/${t.source}/${String(t.index)}/${String(t.output)}/${t.field}`;
    case 'group':
      return `group/${t.group}/${String(t.n)}`;
    case 'snapshot':
      return `snapshot/${String(t.n)}`;
    default:
      return `${t.scope}/${t.field}`;
  }
}

export function kindOf(t: Target): ValueKind {
  switch (t.scope) {
    case 'channel':
      return CHANNEL_FIELDS[t.field].kind;
    case 'route':
      return ROUTE_FIELDS[t.field];
    case 'controlRoom':
      return CONTROL_ROOM_FIELDS[t.field];
    case 'global':
    case 'group':
      return 'switch';
    case 'snapshot':
      return 'snapshot';
    case 'reverb':
      return REVERB_FIELDS[t.field];
    case 'echo':
      return ECHO_FIELDS[t.field];
    case 'status':
      return t.field === 'device' ? 'text' : t.field === 'connection' ? 'switch' : 'number';
    case 'durec':
      return 'text';
  }
}

/** True when `value` has the JavaScript type that `kind` uses. */
export function valueFits(kind: ValueKind, value: Value): boolean {
  switch (kind) {
    case 'switch':
      return typeof value === 'boolean';
    case 'text':
      return typeof value === 'string';
    case 'snapshot':
      return value === 'inactive' || value === 'active' || value === 'modified';
    case 'level':
      return typeof value === 'number' && !Number.isNaN(value) && value !== Infinity;
    case 'channel':
      return typeof value === 'number' && Number.isInteger(value) && value >= NO_CHANNEL;
    case 'db':
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
  }
}

// --- constructors ---------------------------------------------------------------------

export const channel = (bus: Bus, index: number, field: ChannelField): Target => ({
  scope: 'channel',
  bus,
  index,
  field,
});

export const route = (
  source: SourceBus,
  index: number,
  output: number,
  field: RouteField,
): Target => ({ scope: 'route', source, index, output, field });

export const controlRoom = (field: ControlRoomField): Target => ({ scope: 'controlRoom', field });

export const snapshot = (n: number): Target => ({ scope: 'snapshot', n });
