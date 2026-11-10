import { basename } from 'node:path';
import {
  CHANNEL_FIELDS,
  keyOf,
  type Bus,
  type ChannelField,
  type Target,
  type Value,
} from '@faderlight/model';
import {
  encodeMessage,
  float,
  formatMessage,
  int,
  message,
  str,
  TRUE,
  type OscArg,
  type OscMessage,
} from '@faderlight/osc';
import { describe, expect, it } from 'vitest';
import {
  addressOf,
  confirmRequestFor,
  decodeMessage,
  deviceModel,
  encodeCommand,
  encodeRequest,
  float32ToNumber,
  isWritable,
  type Decoded,
  type Request,
} from '../src/index.ts';
import { BASELINE, captureFiles, readCapture, step } from './capture.ts';

// One case per address in docs/protocol/global-osc.md §7, written out from the spec, with a
// value TotalMix sent in the baseline capture where there is one.
interface Case {
  readonly address: string;
  readonly arg: OscArg;
  readonly target: Target;
  readonly value: Value;
}

const ch = (bus: Bus, index: number, field: ChannelField): Target => ({
  scope: 'channel',
  bus,
  index,
  field,
});

const cases: Case[] = [];
const add = (address: string, arg: OscArg, target: Target, value: Value): void => {
  cases.push({ address, arg, target, value });
};

// Status and global
add(
  '/status/device',
  str('Fireface UFX III (XXXXXXXX)'),
  { scope: 'status', field: 'device' },
  'Fireface UFX III',
);
add('/status/connection', float(1), { scope: 'status', field: 'connection' }, true);
add('/status/dsp', float(0), { scope: 'status', field: 'dsp' }, 0);
add('/durec/state', str('Not ready'), { scope: 'durec', field: 'state' }, 'Not ready');
add('/globalmute', float(1), { scope: 'global', field: 'mute' }, true);
add('/globalsolo', float(0), { scope: 'global', field: 'solo' }, false);
for (const k of [1, 2, 3, 4]) {
  add(`/mutegroup/${String(k)}`, float(0), { scope: 'group', group: 'mute', n: k }, false);
  add(`/sologroup/${String(k)}`, float(1), { scope: 'group', group: 'solo', n: k }, true);
  add(`/fadergroup/${String(k)}`, float(0), { scope: 'group', group: 'fader', n: k }, false);
}
const snapshotValues: [number, Value][] = [
  [0, 'inactive'],
  [2, 'active'],
  [3, 'modified'],
];
for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const [wire, value] = snapshotValues[k % 3] ?? [0, 'inactive'];
  add(`/snapshot/load/${String(k)}`, float(wire), { scope: 'snapshot', n: k }, value);
}

// Control room (values from the capture)
const controlRoom: [string, string, OscArg, Value][] = [
  ['dim', 'dim', float(0), false],
  ['dimreduction', 'dimReduction', float(-20), -20],
  ['speakerb', 'speakerB', float(0), false],
  ['linkab', 'linkAB', float(1), true],
  ['mainmono', 'mainMono', float(0), false],
  ['mutefx', 'muteFx', float(0), false],
  ['talkback', 'talkback', float(0), false],
  ['talkchannel', 'talkbackChannel', float(-1), -1],
  ['externalin', 'externalIn', float(0), false],
  ['extinchannel', 'externalInChannel', float(-1), -1],
  ['extingain', 'externalInGain', float(-3), -3],
  ['cuechan', 'cueChannel', float(-1), -1],
  ['mainout', 'mainOut', float(2), 2],
  ['mainoutb', 'mainOutB', float(-1), -1],
  ['phones1', 'phones1', float(8), 8],
  ['phones2', 'phones2', float(10), 10],
  ['phones3', 'phones3', float(-1), -1],
  ['phones4', 'phones4', float(-1), -1],
  ['recallvolume', 'recallVolume', float(Math.fround(-13.09)), -13.09],
];
for (const [wire, field, arg, value] of controlRoom) {
  add(`/controlroom/${wire}`, arg, { scope: 'controlRoom', field } as Target, value);
}

// Channel settings shared by inputs and outputs: low cut, EQ, dynamics, AutoLevel.
const dsp: [string, ChannelField, OscArg, Value][] = [
  ['lowcut/enable', 'lowCut.enable', float(1), true],
  ['lowcut/freq', 'lowCut.freq', float(100), 100],
  ['lowcut/slope', 'lowCut.slope', float(2), 2],
  ['eq/enable', 'eq.enable', float(0), false],
  ['eq/band1type', 'eq.band1.type', float(1), 1],
  ['eq/band1freq', 'eq.band1.freq', float(100), 100],
  ['eq/band1gain', 'eq.band1.gain', float(-2.5), -2.5],
  ['eq/band1q', 'eq.band1.q', float(Math.fround(0.7)), 0.7],
  ['eq/band2freq', 'eq.band2.freq', float(1000), 1000],
  ['eq/band2gain', 'eq.band2.gain', float(3), 3],
  ['eq/band2q', 'eq.band2.q', float(2), 2],
  ['eq/band3type', 'eq.band3.type', float(0), 0],
  ['eq/band3freq', 'eq.band3.freq', float(8000), 8000],
  ['eq/band3gain', 'eq.band3.gain', float(0), 0],
  ['eq/band3q', 'eq.band3.q', float(1), 1],
  ['dynamics/enable', 'dynamics.enable', float(0), false],
  ['dynamics/gain', 'dynamics.gain', float(0), 0],
  ['dynamics/attack', 'dynamics.attack', float(10), 10],
  ['dynamics/release', 'dynamics.release', float(100), 100],
  ['dynamics/compthres', 'dynamics.compThreshold', float(-20), -20],
  ['dynamics/compratio', 'dynamics.compRatio', float(4), 4],
  ['dynamics/expthres', 'dynamics.expThreshold', float(-60), -60],
  ['dynamics/expratio', 'dynamics.expRatio', float(2), 2],
  ['autolevel/enable', 'autoLevel.enable', float(0), false],
  ['autolevel/maxgain', 'autoLevel.maxGain', float(10), 10],
  ['autolevel/headroom', 'autoLevel.headroom', float(6), 6],
  ['autolevel/risetime', 'autoLevel.riseTime', float(3), 3],
];

// Input strips
const input: [string, ChannelField, number, OscArg, Value][] = [
  ['name', 'name', 8, str('OC 818'), 'OC 818'],
  ['mute', 'mute', 8, float(0), false],
  ['stereo', 'stereo', 8, float(1), true],
  ['width', 'width', 8, float(1), 1],
  ['msproc', 'msProc', 8, float(0), false],
  ['color', 'color', 8, float(3), 3],
  ['record', 'record', 8, float(1), true],
  ['fxsend', 'fxSend', 8, float(-300), -Infinity],
  ['gain', 'gain', 9, float(50), 50],
  ['phase', 'phase', 9, float(0), false],
  ['playchan', 'playChan', 9, float(0), 0],
  ['48v', 'phantom', 8, float(1), true],
  ['instrument', 'instrument', 10, float(1), true],
  ['autoset', 'autoSet', 11, float(0), false],
  ['reflevel', 'refLevel', 4, float(1), 1],
  ...dsp.map(([w, f, a, v]): [string, ChannelField, number, OscArg, Value] => [w, f, 8, a, v]),
];
for (const [wire, field, index, arg, value] of input) {
  add(`/input/${String(index)}/${wire}`, arg, ch('input', index, field), value);
}

// Playback strips
const playback: [string, ChannelField, number, OscArg, Value][] = [
  ['name', 'name', 0, str('FROM ZOOM'), 'FROM ZOOM'],
  ['mute', 'mute', 0, float(1), true],
  ['stereo', 'stereo', 0, float(1), true],
  ['width', 'width', 0, float(Math.fround(0.5)), 0.5],
  ['msproc', 'msProc', 0, float(0), false],
  ['color', 'color', 0, float(1), 1],
  ['fxsend', 'fxSend', 0, float(Math.fround(-12.5)), -12.5],
  ['phase', 'phase', 1, float(1), true],
];
for (const [wire, field, index, arg, value] of playback) {
  add(`/playback/${String(index)}/${wire}`, arg, ch('playback', index, field), value);
}

// Output strips
const output: [string, ChannelField, number, OscArg, Value][] = [
  ['name', 'name', 2, str('Main'), 'Main'],
  ['volume', 'volume', 2, float(-20), -20],
  ['mute', 'mute', 2, float(0), false],
  ['balpan', 'balance', 2, float(Math.fround(-0.25)), -0.25],
  ['stereo', 'stereo', 2, float(1), true],
  ['color', 'color', 2, float(1), 1],
  ['record', 'record', 2, float(0), false],
  ['loopback', 'loopback', 0, float(1), true],
  ['talkbacksel', 'talkbackSel', 8, float(0), false],
  ['crossfeed', 'crossfeed', 8, float(2), 2],
  ['fxreturn', 'fxReturn', 2, float(-300), -Infinity],
  ['groupflags', 'groupFlags', 2, float(0), 0],
  ['gain', 'gain', 3, float(0), 0],
  ['phase', 'phase', 3, float(1), true],
  ['playchan', 'playChan', 3, float(0), 0],
  ['delay', 'delay', 3, float(Math.fround(1.5)), 1.5],
  ['reflevel', 'refLevel', 8, float(1), 1],
  ...dsp.map(([w, f, a, v]): [string, ChannelField, number, OscArg, Value] => [w, f, 2, a, v]),
  ['roomeq/enable', 'roomEq.enable', 2, float(1), true],
];
for (let band = 1; band <= 9; band++) {
  const b = String(band);
  output.push(
    [`roomeq/band${b}freq`, `roomEq.band${b}.freq` as ChannelField, 3, float(1000), 1000],
    [`roomeq/band${b}gain`, `roomEq.band${b}.gain` as ChannelField, 3, float(-3), -3],
    [`roomeq/band${b}q`, `roomEq.band${b}.q` as ChannelField, 3, float(2), 2],
  );
}
for (const b of ['1', '8', '9']) {
  output.push([`roomeq/band${b}type`, `roomEq.band${b}.type` as ChannelField, 2, float(1), 1]);
}
for (const [wire, field, index, arg, value] of output) {
  add(`/output/${String(index)}/${wire}`, arg, ch('output', index, field), value);
}

// Matrix
add(
  '/mix/in/8/2/fader',
  float(Math.fround(-3.535715)),
  { scope: 'route', source: 'input', index: 8, output: 2, field: 'fader' },
  -3.535715,
);
add(
  '/mix/pb/0/0/fader',
  float(-300),
  { scope: 'route', source: 'playback', index: 0, output: 0, field: 'fader' },
  -Infinity,
);
add(
  '/mix/in/8/2/balpan',
  float(0),
  { scope: 'route', source: 'input', index: 8, output: 2, field: 'balance' },
  0,
);
add(
  '/mix/in/8/2/solo',
  float(1),
  { scope: 'route', source: 'input', index: 8, output: 2, field: 'solo' },
  true,
);
add(
  '/mix/pb/4/14/groupflags',
  float(0),
  { scope: 'route', source: 'playback', index: 4, output: 14, field: 'groupFlags' },
  0,
);

// Effects
const reverb: [string, string, Value][] = [
  ['enable', 'enable', true],
  ['type', 'type', 3],
  ['predelay', 'preDelay', 20],
  ['lowcut', 'lowCut', 100],
  ['highcut', 'highCut', 10000],
  ['attack', 'attack', 5],
  ['hold', 'hold', 50],
  ['release', 'release', 200],
  ['roomscale', 'roomScale', 1],
  ['time', 'time', 2],
  ['highdamp', 'highDamp', 8000],
  ['smooth', 'smooth', 50],
  ['volume', 'volume', -3],
  ['width', 'width', 1],
];
for (const [wire, field, value] of reverb) {
  add(
    `/reverb/${wire}`,
    float(value === true ? 1 : Number(value)),
    { scope: 'reverb', field } as Target,
    value,
  );
}
const echo: [string, string, Value][] = [
  ['enable', 'enable', false],
  ['type', 'type', 1],
  ['delay', 'delay', 0.5],
  ['feedback', 'feedback', 30],
  ['highcut', 'highCut', 5000],
  ['volume', 'volume', -3],
  ['width', 'width', 1],
];
for (const [wire, field, value] of echo) {
  add(
    `/echo/${wire}`,
    float(value === false ? 0 : Number(value)),
    { scope: 'echo', field } as Target,
    value,
  );
}

describe('decode: every address in the protocol spec', () => {
  it('covers every channel field of the model', () => {
    const covered = new Set(
      cases.flatMap((c) =>
        c.target.scope === 'channel' ? [`${c.target.bus}:${c.target.field}`] : [],
      ),
    );
    for (const [field, info] of Object.entries(CHANNEL_FIELDS)) {
      for (const bus of info.buses) expect(covered, `${bus} ${field}`).toContain(`${bus}:${field}`);
    }
  });

  it.each(cases.map((c) => [formatMessage(message(c.address, c.arg)), c] as const))(
    '%s',
    (_n, c) => {
      expect(decodeMessage(message(c.address, c.arg))).toEqual({
        kind: 'update',
        target: c.target,
        value: c.value,
      });
      expect(addressOf(c.target)).toBe(c.address);
    },
  );

  it.each([
    ['/level/in/8', 'input', 8],
    ['/level/pb/0', 'playback', 0],
    ['/level/out/2', 'output', 2],
  ] as const)('%s is a meter', (address, bus, index) => {
    expect(decodeMessage(message(address, float(Math.fround(-51.80042))))).toEqual({
      kind: 'meter',
      bus,
      index,
      db: -51.80042,
    });
  });
});

describe('encode', () => {
  const writable = cases.filter((c) => isWritable(c.target));

  it.each(writable.map((c) => [c.address, c] as const))('set %s', (_n, c) => {
    // Compared as bytes: the wire carries float32, so -13.09 and fround(-13.09) are the same.
    expect(encodeMessage(encodeCommand({ type: 'set', target: c.target, value: c.value }))).toEqual(
      encodeMessage(message(c.address, c.arg)),
    );
  });

  it('sends switches as float 0/1 and off as -300', () => {
    expect(encodeCommand({ type: 'set', target: ch('input', 8, 'mute'), value: true })).toEqual(
      message('/input/8/mute', float(1)),
    );
    expect(
      encodeCommand({ type: 'set', target: ch('output', 2, 'volume'), value: -Infinity }),
    ).toEqual(message('/output/2/volume', float(-300)));
  });

  it('loads a snapshot by sending 1 to its address', () => {
    expect(encodeCommand({ type: 'loadSnapshot', n: 3 })).toEqual(
      message('/snapshot/load/3', float(1)),
    );
  });

  it('refuses read-only targets, wrong buses and values that do not fit', () => {
    const set = (target: Target, value: Value) => () =>
      encodeCommand({ type: 'set', target, value });
    expect(set({ scope: 'status', field: 'device' }, 'x')).toThrow(/read-only/);
    expect(set({ scope: 'durec', field: 'state' }, 'x')).toThrow(/read-only/);
    expect(set({ scope: 'snapshot', n: 1 }, 'active')).toThrow(/read-only/);
    expect(set(ch('playback', 0, 'volume'), 0)).toThrow(/playback channels have no volume/);
    expect(set(ch('input', 8, 'mute'), 1)).toThrow(/not a valid switch/);
    expect(set(ch('input', 8, 'name'), 1)).toThrow(/not a valid text/);
    expect(set(ch('input', 8, 'gain'), NaN)).toThrow(/not a valid db/);
    expect(set(ch('input', 8, 'gain'), -Infinity)).toThrow(/not a valid db/);
    expect(set(ch('output', 2, 'volume'), Infinity)).toThrow(/not a valid level/);
    expect(set({ scope: 'controlRoom', field: 'mainOut' }, 1.5)).toThrow(/not a valid channel/);
    expect(set(ch('input', -1, 'mute'), true)).toThrow(/bad channel index/);
    expect(set({ scope: 'group', group: 'mute', n: 5 }, true)).toThrow(/bad group/);
    expect(() => encodeCommand({ type: 'loadSnapshot', n: 9 })).toThrow(/bad snapshot/);
  });
});

describe('decode: what is not recognised', () => {
  it.each([
    ['/faderlight/probe', float(1), 'unknown address'],
    ['/input/x/mute', float(1), 'unknown channel address'],
    ['/input/8/bogus', float(1), 'unknown channel address'],
    ['/input/8', float(1), 'unknown channel address'],
    ['/input/8/mute', str('on'), 'expected a number'],
    ['/input/8/name', float(1), 'expected a string'],
    ['/input/8/mute', undefined, 'expected a number'],
    ['/mix/in/8/2', float(0), 'unknown matrix address'],
    ['/mix/xx/8/2/fader', float(0), 'unknown matrix address'],
    ['/level/in/8/x', float(0), 'unknown meter address'],
    ['/level/in/8', str('x'), 'expected a number'],
    ['/controlroom/dim/x', float(0), 'unknown control room address'],
    ['/controlroom/bogus', float(0), 'unknown control room address'],
    ['/snapshot/load/9', float(2), 'unknown snapshot address'],
    ['/snapshot/load/1', float(1), 'unexpected snapshot value 1'],
    ['/snapshot/save/1', float(1), 'unknown snapshot address'],
    ['/mutegroup/5', float(0), 'unknown address'],
    ['/status/bogus', float(0), 'unknown status address'],
    ['/status/device', float(0), 'expected a string'],
    ['/durec/time', float(0), 'unknown DURec address'],
    ['/reverb/bogus', float(0), 'unknown reverb address'],
    ['/echo/bogus', float(0), 'unknown echo address'],
    ['/globalmute/1', float(0), 'unknown global address'],
  ])('%s %s', (address, arg, reason) => {
    const msg: OscMessage = { address, args: arg === undefined ? [] : [arg] };
    expect(decodeMessage(msg)).toEqual({ kind: 'unknown', reason });
  });

  it('reads int and T/F arguments like floats', () => {
    expect(decodeMessage(message('/input/8/mute', int(1)))).toMatchObject({ value: true });
    expect(decodeMessage(message('/input/8/mute', TRUE))).toMatchObject({ value: true });
  });

  it('keeps the serial number of the interface out of the model', () => {
    expect(deviceModel('Fireface UFX III (12345678)')).toBe('Fireface UFX III');
    expect(deviceModel('Fireface UFX III')).toBe('Fireface UFX III');
    expect(deviceModel('Some (odd) name (123)')).toBe('Some (odd) name');
  });

  it('turns float32 values into their shortest decimal', () => {
    expect(float32ToNumber(Math.fround(-3.535715))).toBe(-3.535715);
    expect(float32ToNumber(Math.fround(0.1))).toBe(0.1);
    expect(float32ToNumber(-300)).toBe(-300);
  });
});

describe('requests', () => {
  const requests: [Request, string][] = [
    [{ type: 'state' }, '/sendstate f:1'],
    [{ type: 'settings' }, '/sendsettings f:1'],
    [{ type: 'channel', bus: 'input', index: 8 }, '/sendchan/input/8 f:1'],
    [{ type: 'channel', bus: 'playback', index: 0 }, '/sendchan/playback/0 f:1'],
    [{ type: 'channel', bus: 'output', index: 8 }, '/sendchan/output/8 f:1'],
    [{ type: 'submix', output: 0 }, '/sendsubmix/0 f:1'],
    [{ type: 'mix' }, '/sendmix f:1'],
    [{ type: 'all', routes: 'on' }, '/sendall f:2'],
    [{ type: 'all', routes: 'all' }, '/sendall f:1'],
  ];

  it.each(requests)('%o is %s', (request, text) => {
    expect(formatMessage(encodeRequest(request))).toBe(text);
  });

  it('confirms each kind of target with the request that reports it', () => {
    expect(confirmRequestFor(ch('input', 8, 'mute'))).toEqual({
      type: 'channel',
      bus: 'input',
      index: 8,
    });
    expect(
      confirmRequestFor({ scope: 'route', source: 'input', index: 8, output: 2, field: 'fader' }),
    ).toEqual({ type: 'submix', output: 2 });
    expect(confirmRequestFor({ scope: 'controlRoom', field: 'dim' })).toEqual({ type: 'settings' });
    expect(confirmRequestFor({ scope: 'global', field: 'mute' })).toEqual({ type: 'settings' });
    expect(confirmRequestFor({ scope: 'group', group: 'solo', n: 1 })).toEqual({
      type: 'settings',
    });
    expect(confirmRequestFor({ scope: 'snapshot', n: 1 })).toEqual({ type: 'settings' });
    expect(confirmRequestFor({ scope: 'reverb', field: 'time' })).toEqual({ type: 'settings' });
    expect(confirmRequestFor({ scope: 'durec', field: 'state' })).toEqual({ type: 'state' });
  });
});

// --- captured traffic -----------------------------------------------------------------

describe.each(captureFiles().map((file) => [basename(file), file]))('capture %s', (_name, file) => {
  const capture = readCapture(file);

  it('decodes every message TotalMix sent', () => {
    const unknown: string[] = [];
    const keys = new Set<string>();
    let meters = 0;
    for (const d of capture.received) {
      for (const m of d.messages) {
        const decoded: Decoded = decodeMessage(m);
        if (decoded.kind === 'unknown') unknown.push(`${formatMessage(m)}: ${decoded.reason}`);
        else if (decoded.kind === 'meter') meters++;
        else keys.add(keyOf(decoded.target));
      }
    }
    for (const address of capture.thinnedLevels.keys()) {
      const decoded = decodeMessage(message(address, float(-100)));
      if (decoded.kind !== 'meter') unknown.push(address);
    }
    expect(unknown).toEqual([]);
    expect(meters).toBeGreaterThan(0);
    expect(keys.size).toBeGreaterThan(100);
  });

  it('decodes requests and float/string writes it sent, and re-encodes them byte for byte', () => {
    let checked = 0;
    for (const s of capture.steps) {
      for (const d of s.sent) {
        for (const m of d.messages) {
          if (m.address.startsWith('/send')) continue;
          // int and T/F variants were sent to test TotalMix; the adaptor always sends float32.
          if (m.args.some((a) => a.type !== 'f' && a.type !== 's')) continue;
          const decoded = decodeMessage(m);
          if (decoded.kind !== 'update') continue; // e.g. the unknown-address probe
          expect(
            encodeMessage(
              encodeCommand({ type: 'set', target: decoded.target, value: decoded.value }),
            ),
          ).toEqual(encodeMessage(m));
          checked++;
        }
      }
    }
    if (basename(file) === basename(BASELINE)) expect(checked).toBeGreaterThanOrEqual(8);
  });
});

describe('baseline capture: requests the adaptor sends are the ones TotalMix answered', () => {
  const capture = readCapture(BASELINE);
  const sentIn = (id: string): Uint8Array[] =>
    step(capture, id).sent.map((d) => encodeMessage(d.messages[0] ?? message('/none')));

  it.each([
    ['sendstate', { type: 'state' }],
    ['sendsettings', { type: 'settings' }],
    ['sendchan-input', { type: 'channel', bus: 'input', index: 8 }],
    ['sendchan-playback', { type: 'channel', bus: 'playback', index: 0 }],
    ['sendchan-output', { type: 'channel', bus: 'output', index: 0 }],
    ['sendsubmix', { type: 'submix', output: 0 }],
    ['sendmix', { type: 'mix' }],
    ['sendall-2', { type: 'all', routes: 'on' }],
    ['sendall-1', { type: 'all', routes: 'all' }],
  ] as [string, Request][])('%s', (id, request) => {
    expect(sentIn(id)).toEqual([encodeMessage(encodeRequest(request))]);
    expect(step(capture, id).received.some((d) => !d.meter)).toBe(true);
  });
});
