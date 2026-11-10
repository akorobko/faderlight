// Global OSC address map: decodes TotalMix messages into model updates and encodes commands
// and state requests. Pure functions; every rule here comes from docs/protocol/global-osc.md.

import {
  CHANNEL_FIELDS,
  kindOf,
  NO_CHANNEL,
  type Bus,
  type ChannelField,
  type ControlRoomField,
  type EchoField,
  type GroupKind,
  type ReverbField,
  type RouteField,
  type SnapshotState,
  type SourceBus,
  type Target,
  type Value,
  type ValueKind,
} from '@faderlight/model';
import {
  argNumber,
  argString,
  float,
  message,
  str,
  type OscArg,
  type OscMessage,
} from '@faderlight/osc';

/** Wire value for off on faders and sends (−∞). */
export const OFF_DB = -300;

// --- wire names -----------------------------------------------------------------------

const BUS_WIRE: Readonly<Record<string, Bus>> = {
  input: 'input',
  playback: 'playback',
  output: 'output',
};
const METER_WIRE: Readonly<Record<string, Bus>> = { in: 'input', pb: 'playback', out: 'output' };
const ROUTE_SOURCE_WIRE: Readonly<Record<string, SourceBus>> = { in: 'input', pb: 'playback' };
const ROUTE_SOURCE_NAME: Readonly<Record<SourceBus, string>> = { input: 'in', playback: 'pb' };

/** Channel settings: wire suffix after `/{bus}/{n}/` → model field. */
const CHANNEL_WIRE: Readonly<Record<string, ChannelField>> = {
  name: 'name',
  mute: 'mute',
  stereo: 'stereo',
  width: 'width',
  msproc: 'msProc',
  color: 'color',
  record: 'record',
  fxsend: 'fxSend',
  '48v': 'phantom',
  instrument: 'instrument',
  autoset: 'autoSet',
  reflevel: 'refLevel',
  volume: 'volume',
  balpan: 'balance',
  loopback: 'loopback',
  talkbacksel: 'talkbackSel',
  crossfeed: 'crossfeed',
  fxreturn: 'fxReturn',
  groupflags: 'groupFlags',
  gain: 'gain',
  phase: 'phase',
  playchan: 'playChan',
  delay: 'delay',
  'lowcut/enable': 'lowCut.enable',
  'lowcut/freq': 'lowCut.freq',
  'lowcut/slope': 'lowCut.slope',
  'eq/enable': 'eq.enable',
  'eq/band1type': 'eq.band1.type',
  'eq/band1freq': 'eq.band1.freq',
  'eq/band1gain': 'eq.band1.gain',
  'eq/band1q': 'eq.band1.q',
  'eq/band2freq': 'eq.band2.freq',
  'eq/band2gain': 'eq.band2.gain',
  'eq/band2q': 'eq.band2.q',
  'eq/band3type': 'eq.band3.type',
  'eq/band3freq': 'eq.band3.freq',
  'eq/band3gain': 'eq.band3.gain',
  'eq/band3q': 'eq.band3.q',
  'dynamics/enable': 'dynamics.enable',
  'dynamics/gain': 'dynamics.gain',
  'dynamics/attack': 'dynamics.attack',
  'dynamics/release': 'dynamics.release',
  'dynamics/compthres': 'dynamics.compThreshold',
  'dynamics/compratio': 'dynamics.compRatio',
  'dynamics/expthres': 'dynamics.expThreshold',
  'dynamics/expratio': 'dynamics.expRatio',
  'autolevel/enable': 'autoLevel.enable',
  'autolevel/maxgain': 'autoLevel.maxGain',
  'autolevel/headroom': 'autoLevel.headroom',
  'autolevel/risetime': 'autoLevel.riseTime',
  'roomeq/enable': 'roomEq.enable',
  ...(Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((b) => [
      [`roomeq/band${String(b)}freq`, `roomEq.band${String(b)}.freq`],
      [`roomeq/band${String(b)}gain`, `roomEq.band${String(b)}.gain`],
      [`roomeq/band${String(b)}q`, `roomEq.band${String(b)}.q`],
      ...(b === 1 || b === 8 || b === 9
        ? [[`roomeq/band${String(b)}type`, `roomEq.band${String(b)}.type`]]
        : []),
    ]),
  ) as Record<string, ChannelField>),
};

const ROUTE_WIRE: Readonly<Record<string, RouteField>> = {
  fader: 'fader',
  balpan: 'balance',
  solo: 'solo',
  groupflags: 'groupFlags',
};

const CONTROL_ROOM_WIRE: Readonly<Record<string, ControlRoomField>> = {
  dim: 'dim',
  dimreduction: 'dimReduction',
  speakerb: 'speakerB',
  linkab: 'linkAB',
  mainmono: 'mainMono',
  mutefx: 'muteFx',
  talkback: 'talkback',
  talkchannel: 'talkbackChannel',
  externalin: 'externalIn',
  extinchannel: 'externalInChannel',
  extingain: 'externalInGain',
  cuechan: 'cueChannel',
  mainout: 'mainOut',
  mainoutb: 'mainOutB',
  phones1: 'phones1',
  phones2: 'phones2',
  phones3: 'phones3',
  phones4: 'phones4',
  recallvolume: 'recallVolume',
};

const REVERB_WIRE: Readonly<Record<string, ReverbField>> = {
  enable: 'enable',
  type: 'type',
  predelay: 'preDelay',
  lowcut: 'lowCut',
  highcut: 'highCut',
  attack: 'attack',
  hold: 'hold',
  release: 'release',
  roomscale: 'roomScale',
  time: 'time',
  highdamp: 'highDamp',
  smooth: 'smooth',
  volume: 'volume',
  width: 'width',
};

const ECHO_WIRE: Readonly<Record<string, EchoField>> = {
  enable: 'enable',
  type: 'type',
  delay: 'delay',
  feedback: 'feedback',
  highcut: 'highCut',
  volume: 'volume',
  width: 'width',
};

const GROUP_WIRE: Readonly<Record<string, GroupKind>> = {
  mutegroup: 'mute',
  sologroup: 'solo',
  fadergroup: 'fader',
};

const invert = <K extends string, V extends string>(
  table: Readonly<Record<K, V>>,
): Readonly<Record<V, K>> =>
  Object.fromEntries(Object.entries(table).map(([k, v]) => [v, k])) as Record<V, K>;

const CHANNEL_NAME = invert(CHANNEL_WIRE);
const ROUTE_NAME = invert(ROUTE_WIRE);
const CONTROL_ROOM_NAME = invert(CONTROL_ROOM_WIRE);
const REVERB_NAME = invert(REVERB_WIRE);
const ECHO_NAME = invert(ECHO_WIRE);
const GROUP_NAME = invert(GROUP_WIRE);

const lookup = <V>(table: Readonly<Record<string, V>>, key: string | undefined): V | undefined =>
  key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;

// --- values ---------------------------------------------------------------------------

/** Shortest decimal that reads back as the same float32, e.g. -3.535715 rather than -3.5357151031494141. */
export function float32ToNumber(v: number): number {
  if (!Number.isFinite(v) || Number.isInteger(v)) return v;
  for (let p = 1; p <= 9; p++) {
    const n = Number(v.toPrecision(p));
    if (Math.fround(n) === v) return n;
  }
  return v;
}

const SNAPSHOT_STATES: Readonly<Record<number, SnapshotState>> = {
  0: 'inactive',
  2: 'active',
  3: 'modified',
};

/** Model value of a wire argument, or a reason it does not fit the value kind. */
export function valueFromWire(kind: ValueKind, arg: OscArg | undefined): Value | { error: string } {
  if (kind === 'text') {
    const s = argString(arg);
    return s ?? { error: 'expected a string' };
  }
  const raw = argNumber(arg);
  if (raw === undefined || Number.isNaN(raw)) return { error: 'expected a number' };
  const n = float32ToNumber(raw);
  switch (kind) {
    case 'switch':
      return n >= 0.5;
    case 'level':
      return n <= OFF_DB ? -Infinity : n;
    case 'channel':
      return Math.round(n) < 0 ? NO_CHANNEL : Math.round(n);
    case 'snapshot': {
      const state = SNAPSHOT_STATES[n];
      return state ?? { error: `unexpected snapshot value ${String(n)}` };
    }
    case 'db':
    case 'number':
      return n;
  }
}

/** Wire argument for a model value. Throws when the value does not fit the kind. */
export function valueToWire(kind: ValueKind, value: Value): OscArg {
  switch (kind) {
    case 'text':
      if (typeof value !== 'string') break;
      return str(value);
    case 'switch':
      if (typeof value !== 'boolean') break;
      return float(value ? 1 : 0);
    case 'level':
      if (typeof value !== 'number' || Number.isNaN(value) || value === Infinity) break;
      return float(Math.max(OFF_DB, value));
    case 'channel':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < NO_CHANNEL) break;
      return float(value);
    case 'db':
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) break;
      return float(value);
    case 'snapshot':
      throw new TypeError('snapshots are loaded with a loadSnapshot command, not set');
  }
  throw new TypeError(`${JSON.stringify(value)} is not a valid ${kind} value`);
}

// --- decoding -------------------------------------------------------------------------

export type Decoded =
  | { readonly kind: 'update'; readonly target: Target; readonly value: Value }
  | { readonly kind: 'meter'; readonly bus: Bus; readonly index: number; readonly db: number }
  | { readonly kind: 'unknown'; readonly reason: string };

const unknown = (reason: string): Decoded => ({ kind: 'unknown', reason });

const MAX_INDEX = 1023;

function parseIndex(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d{1,4}$/.test(text)) return undefined;
  const n = Number(text);
  return n <= MAX_INDEX ? n : undefined;
}

function parseNumberIn(text: string | undefined, min: number, max: number): number | undefined {
  const n = parseIndex(text);
  return n !== undefined && n >= min && n <= max ? n : undefined;
}

/** "Fireface UFX III (12345678)" → "Fireface UFX III": the serial never enters the model. */
export function deviceModel(status: string): string {
  const match = /^(.*?)\s*\([^()]*\)\s*$/.exec(status);
  return (match?.[1] ?? status).trim();
}

function update(target: Target, arg: OscArg | undefined): Decoded {
  const value = valueFromWire(kindOf(target), arg);
  if (typeof value === 'object') return unknown(value.error);
  return { kind: 'update', target, value };
}

/** Decodes one TotalMix message. Never throws; unrecognised messages come back as `unknown`. */
export function decodeMessage(msg: OscMessage): Decoded {
  const parts = msg.address.split('/').slice(1);
  const [head, a, b, c, ...rest] = parts;
  const arg = msg.args[0];

  if (head === undefined) return unknown('empty address');

  const bus = lookup(BUS_WIRE, head);
  if (bus !== undefined) {
    const index = parseIndex(a);
    const field = lookup(CHANNEL_WIRE, [b, c, ...rest].filter((p) => p !== undefined).join('/'));
    if (index === undefined || field === undefined) return unknown('unknown channel address');
    return update({ scope: 'channel', bus, index, field }, arg);
  }

  switch (head) {
    case 'level': {
      const meterBus = lookup(METER_WIRE, a);
      const index = parseIndex(b);
      const db = argNumber(arg);
      if (meterBus === undefined || index === undefined || c !== undefined) {
        return unknown('unknown meter address');
      }
      if (db === undefined || Number.isNaN(db)) return unknown('expected a number');
      return { kind: 'meter', bus: meterBus, index, db: float32ToNumber(db) };
    }
    case 'mix': {
      const source = lookup(ROUTE_SOURCE_WIRE, a);
      const index = parseIndex(b);
      const output = parseIndex(c);
      const field = rest.length === 1 ? lookup(ROUTE_WIRE, rest[0]) : undefined;
      if (source === undefined || index === undefined || output === undefined || !field) {
        return unknown('unknown matrix address');
      }
      return update({ scope: 'route', source, index, output, field }, arg);
    }
    case 'controlroom': {
      const field = b === undefined ? lookup(CONTROL_ROOM_WIRE, a) : undefined;
      return field
        ? update({ scope: 'controlRoom', field }, arg)
        : unknown('unknown control room address');
    }
    case 'reverb': {
      const field = b === undefined ? lookup(REVERB_WIRE, a) : undefined;
      return field ? update({ scope: 'reverb', field }, arg) : unknown('unknown reverb address');
    }
    case 'echo': {
      const field = b === undefined ? lookup(ECHO_WIRE, a) : undefined;
      return field ? update({ scope: 'echo', field }, arg) : unknown('unknown echo address');
    }
    case 'snapshot': {
      const n = a === 'load' && c === undefined ? parseNumberIn(b, 1, 8) : undefined;
      return n === undefined
        ? unknown('unknown snapshot address')
        : update({ scope: 'snapshot', n }, arg);
    }
    case 'globalmute':
    case 'globalsolo':
      if (a !== undefined) return unknown('unknown global address');
      return update({ scope: 'global', field: head === 'globalmute' ? 'mute' : 'solo' }, arg);
    case 'status': {
      if (b !== undefined) return unknown('unknown status address');
      if (a === 'device') {
        const s = argString(arg);
        if (s === undefined) return unknown('expected a string');
        return {
          kind: 'update',
          target: { scope: 'status', field: 'device' },
          value: deviceModel(s),
        };
      }
      if (a === 'connection' || a === 'dsp') return update({ scope: 'status', field: a }, arg);
      return unknown('unknown status address');
    }
    case 'durec':
      if (a === 'state' && b === undefined) return update({ scope: 'durec', field: 'state' }, arg);
      return unknown('unknown DURec address');
    default: {
      const group = lookup(GROUP_WIRE, head);
      const n = b === undefined ? parseNumberIn(a, 1, 4) : undefined;
      if (group !== undefined && n !== undefined) return update({ scope: 'group', group, n }, arg);
      return unknown('unknown address');
    }
  }
}

// --- encoding -------------------------------------------------------------------------

/** OSC address of a target, as TotalMix sends and accepts it. */
export function addressOf(t: Target): string {
  switch (t.scope) {
    case 'channel':
      return `/${t.bus}/${String(t.index)}/${CHANNEL_NAME[t.field]}`;
    case 'route':
      return `/mix/${ROUTE_SOURCE_NAME[t.source]}/${String(t.index)}/${String(t.output)}/${ROUTE_NAME[t.field]}`;
    case 'controlRoom':
      return `/controlroom/${CONTROL_ROOM_NAME[t.field]}`;
    case 'global':
      return t.field === 'mute' ? '/globalmute' : '/globalsolo';
    case 'group':
      return `/${GROUP_NAME[t.group]}/${String(t.n)}`;
    case 'snapshot':
      return `/snapshot/load/${String(t.n)}`;
    case 'reverb':
      return `/reverb/${REVERB_NAME[t.field]}`;
    case 'echo':
      return `/echo/${ECHO_NAME[t.field]}`;
    case 'status':
      return `/status/${t.field}`;
    case 'durec':
      return '/durec/state';
  }
}

/** False for state that TotalMix only reports (status, DURec state) or that is not set by value (snapshots). */
export function isWritable(t: Target): boolean {
  return t.scope !== 'status' && t.scope !== 'durec' && t.scope !== 'snapshot';
}

export type Command =
  | { readonly type: 'set'; readonly target: Target; readonly value: Value }
  | { readonly type: 'loadSnapshot'; readonly n: number };

function checkIndex(n: number, what: string): void {
  if (!Number.isInteger(n) || n < 0 || n > MAX_INDEX)
    throw new RangeError(`bad ${what}: ${String(n)}`);
}

function checkTarget(t: Target): void {
  switch (t.scope) {
    case 'channel':
      checkIndex(t.index, 'channel index');
      if (!CHANNEL_FIELDS[t.field].buses.includes(t.bus)) {
        throw new RangeError(`${t.bus} channels have no ${t.field}`);
      }
      break;
    case 'route':
      checkIndex(t.index, 'source index');
      checkIndex(t.output, 'output index');
      break;
    case 'group':
      if (!Number.isInteger(t.n) || t.n < 1 || t.n > 4)
        throw new RangeError(`bad group ${String(t.n)}`);
      break;
    case 'snapshot':
      if (!Number.isInteger(t.n) || t.n < 1 || t.n > 8) {
        throw new RangeError(`bad snapshot ${String(t.n)}`);
      }
      break;
    default:
      break;
  }
}

/**
 * Encodes a command. A set writes the value to the same address TotalMix reports it on; every
 * number goes out as float32. Throws for read-only targets and values that do not fit.
 */
export function encodeCommand(cmd: Command): OscMessage {
  if (cmd.type === 'loadSnapshot') {
    checkTarget({ scope: 'snapshot', n: cmd.n });
    // Inferred, not yet captured: a 1 on the snapshot's address loads it (see the spec, §4).
    return message(`/snapshot/load/${String(cmd.n)}`, float(1));
  }
  const { target, value } = cmd;
  if (!isWritable(target)) throw new TypeError(`${addressOf(target)} is read-only`);
  checkTarget(target);
  return message(addressOf(target), valueToWire(kindOf(target), value));
}

// --- requests -------------------------------------------------------------------------

export type Request =
  | { readonly type: 'state' }
  | { readonly type: 'settings' }
  | { readonly type: 'channel'; readonly bus: Bus; readonly index: number }
  | { readonly type: 'submix'; readonly output: number }
  | { readonly type: 'mix' }
  | { readonly type: 'all'; readonly routes: 'all' | 'on' };

/** Request address; the argument is ignored by TotalMix, so `f:1` is sent like in the capture. */
export function encodeRequest(r: Request): OscMessage {
  switch (r.type) {
    case 'state':
      return message('/sendstate', float(1));
    case 'settings':
      return message('/sendsettings', float(1));
    case 'channel':
      checkIndex(r.index, 'channel index');
      return message(`/sendchan/${r.bus}/${String(r.index)}`, float(1));
    case 'submix':
      checkIndex(r.output, 'output index');
      return message(`/sendsubmix/${String(r.output)}`, float(1));
    case 'mix':
      return message('/sendmix', float(1));
    case 'all':
      // 1: every route; 2: only routes that are on (smaller, enough for a full sync).
      return message('/sendall', float(r.routes === 'all' ? 1 : 2));
  }
}

/** The request whose reply contains a target's current value. */
export function confirmRequestFor(t: Target): Request {
  switch (t.scope) {
    case 'channel':
      return { type: 'channel', bus: t.bus, index: t.index };
    case 'route':
      return { type: 'submix', output: t.output };
    case 'status':
    case 'durec':
      return { type: 'state' };
    default:
      return { type: 'settings' };
  }
}
