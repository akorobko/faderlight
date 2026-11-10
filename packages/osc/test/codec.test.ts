import { basename } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  argNumber,
  argString,
  bundle,
  decodePacket,
  encodeMessage,
  encodePacket,
  FALSE,
  float,
  formatMessage,
  int,
  isBundle,
  message,
  messagesOf,
  OscDecodeError,
  str,
  TRUE,
  type OscArg,
  type OscBundle,
  type OscMessage,
  type OscPacket,
} from '../src/index.ts';
import { captureFiles, receivedDatagrams } from './capture.ts';

const hex = (text: string): Uint8Array =>
  new Uint8Array(Buffer.from(text.replace(/\s+/g, ''), 'hex'));

describe('byte fixtures', () => {
  // The two examples from the OSC 1.0 specification.
  it('encodes and decodes /oscillator/4/frequency ,f 440.0', () => {
    const bytes = hex(`
      2f6f7363 696c6c61 746f722f 342f6672 65717565 6e637900
      2c660000 43dc0000`);
    const msg = message('/oscillator/4/frequency', float(440));
    expect(encodeMessage(msg)).toEqual(bytes);
    expect(decodePacket(bytes)).toEqual(msg);
  });

  it('encodes and decodes /foo ,iisff 1000 -1 "hello" 1.234 5.678', () => {
    const bytes = hex(`
      2f666f6f 00000000 2c696973 66660000
      000003e8 ffffffff 68656c6c 6f000000
      3f9df3b6 40b5b22d`);
    const msg = message(
      '/foo',
      int(1000),
      int(-1),
      str('hello'),
      float(Math.fround(1.234)),
      float(Math.fround(5.678)),
    );
    expect(encodeMessage(msg)).toEqual(bytes);
    expect(decodePacket(bytes)).toEqual(msg);
  });

  it('decodes a TotalMix /sendstate reply (a bundle with timetag 0)', () => {
    // From the baseline capture; the serial number is masked there.
    const bytes = new Uint8Array(
      Buffer.from(
        'I2J1bmRsZQAAAAAAAAAAAAAAADAvc3RhdHVzL2RldmljZQAALHMAAEZpcmVmYWNlIFVGWCBJSUkgKFhYWFhYWFhYKQAAAAAcL3N0YXR1cy9jb25uZWN0aW9uAAAsZgAAP4AAAAAAABQvc3RhdHVzL2RzcAAsZgAAAAAAAAAAACAvZHVyZWMvc3RhdGUAAAAALHMAAE5vdCByZWFkeQAAAA==',
        'base64',
      ),
    );
    const packet = decodePacket(bytes);
    expect(packet).toEqual(
      bundle(
        [
          message('/status/device', str('Fireface UFX III (XXXXXXXX)')),
          message('/status/connection', float(1)),
          message('/status/dsp', float(0)),
          message('/durec/state', str('Not ready')),
        ],
        0n,
      ),
    );
    expect(encodePacket(packet)).toEqual(bytes);
  });

  it('encodes every argument type with the right size and padding', () => {
    const msg = message(
      '/all',
      int(-2),
      float(0.5),
      { type: 'd', value: 0.1 },
      { type: 'h', value: -5n },
      { type: 't', value: 1n },
      str('abc'),
      { type: 'S', value: 'abcd' },
      { type: 'c', value: 'é' },
      { type: 'r', value: 0xff0000ff },
      { type: 'm', value: new Uint8Array([0, 0x90, 60, 100]) },
      { type: 'b', value: new Uint8Array([1, 2, 3, 4, 5]) },
      TRUE,
      FALSE,
      { type: 'N' },
      { type: 'I' },
    );
    const bytes = encodeMessage(msg);
    expect(bytes.byteLength % 4).toBe(0);
    // address 8 + tags 20 + i 4 + f 4 + d 8 + h 8 + t 8 + s 4 + S 8 + c 4 + r 4 + m 4 + b 4+8
    expect(bytes.byteLength).toBe(8 + 20 + 4 + 4 + 8 + 8 + 8 + 4 + 8 + 4 + 4 + 4 + 12);
    expect(decodePacket(bytes)).toEqual(msg);
  });

  it('encodes a message without arguments with an empty type tag string', () => {
    expect(encodeMessage(message('/sendstate'))).toEqual(
      hex('2f73656e 64737461 74650000 2c000000'),
    );
  });

  it('reads a message without a type tag string as having no arguments', () => {
    expect(decodePacket(hex('2f73656e 64737461 74650000'))).toEqual(message('/sendstate'));
  });

  it('stores float arguments as float32', () => {
    const decoded = decodePacket(encodeMessage(message('/x', float(0.1))));
    expect(decoded).toEqual(message('/x', float(Math.fround(0.1))));
  });
});

describe('errors', () => {
  const cases: [string, Uint8Array, RegExp][] = [
    ['empty packet', new Uint8Array(), /empty packet/],
    ['address without slash', hex('61626300'), /address must start/],
    ['unterminated address', hex('2f616263'), /unterminated string/],
    ['type tags without comma', hex('2f610000 66000000'), /type tag string must start/],
    ['truncated float', hex('2f610000 2c660000 3f80'), /truncated float32/],
    ['unknown type tag', hex('2f610000 2c780000'), /unsupported type tag "x"/],
    ['negative blob size', hex('2f610000 2c620000 ffffffff'), /negative blob size/],
    ['unknown packet header', hex('23626164 00000000'), /unknown packet header/],
    ['truncated timetag', hex('2362756e 646c6500 00000000'), /truncated bundle timetag/],
    [
      'bad element size',
      hex('2362756e 646c6500 00000000 00000000 00000003 2f610000'),
      /bad bundle element size 3/,
    ],
    [
      'element past the end',
      hex('2362756e 646c6500 00000000 00000000 00000010 2f610000'),
      /truncated bundle element/,
    ],
  ];

  it.each(cases)('rejects %s', (_name, bytes, pattern) => {
    expect(() => decodePacket(bytes)).toThrow(OscDecodeError);
    expect(() => decodePacket(bytes)).toThrow(pattern);
  });

  it('reports the byte offset', () => {
    try {
      decodePacket(hex('2f610000 2c660000 3f80'));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(OscDecodeError);
      expect((e as OscDecodeError).offset).toBe(8);
    }
  });

  it('rejects bundles nested deeper than 8 levels', () => {
    let p: OscPacket = message('/deep');
    for (let i = 0; i < 9; i++) p = bundle([p]);
    expect(() => decodePacket(encodePacket(p))).toThrow(/nested too deeply/);
  });

  it('refuses to encode invalid messages', () => {
    expect(() => encodeMessage(message('no-slash'))).toThrow(/must start with/);
    expect(() => encodeMessage(message('/a\0b'))).toThrow(/NUL/);
    expect(() => encodeMessage(message('/a', str('x\0')))).toThrow(/NUL/);
    expect(() => encodeMessage(message('/a', int(1.5)))).toThrow(RangeError);
    expect(() => encodeMessage(message('/a', int(2 ** 31)))).toThrow(RangeError);
    expect(() => encodeMessage(message('/a', { type: 'm', value: new Uint8Array(3) }))).toThrow(
      RangeError,
    );
  });
});

describe('helpers', () => {
  it('flattens nested bundles in order', () => {
    const p = bundle([message('/a'), bundle([message('/b'), message('/c')]), message('/d')]);
    expect(messagesOf(p).map((m) => m.address)).toEqual(['/a', '/b', '/c', '/d']);
    expect(messagesOf(message('/x'))).toEqual([message('/x')]);
    expect(isBundle(p)).toBe(true);
    expect(isBundle(message('/x'))).toBe(false);
  });

  it('reads numbers and strings from arguments', () => {
    expect(argNumber(float(0.5))).toBe(0.5);
    expect(argNumber(int(3))).toBe(3);
    expect(argNumber(TRUE)).toBe(1);
    expect(argNumber(FALSE)).toBe(0);
    expect(argNumber(str('1'))).toBeUndefined();
    expect(argNumber(undefined)).toBeUndefined();
    expect(argString(str('Main'))).toBe('Main');
    expect(argString(float(1))).toBeUndefined();
  });

  it('formats messages on one line', () => {
    expect(formatMessage(message('/input/8/name', str('FL test'), float(1), TRUE))).toBe(
      '/input/8/name s:"FL test" f:1 T',
    );
  });
});

// --- properties -----------------------------------------------------------------------

const text = fc.string({ unit: 'grapheme', maxLength: 24 }).map((s) => s.replaceAll('\0', ''));

const argArb: fc.Arbitrary<OscArg> = fc.oneof(
  fc.integer({ min: -0x80000000, max: 0x7fffffff }).map((value) => ({ type: 'i', value }) as const),
  fc.float().map((value) => ({ type: 'f', value }) as const),
  fc.double().map((value) => ({ type: 'd', value }) as const),
  fc
    .bigInt({ min: -(1n << 63n), max: (1n << 63n) - 1n })
    .map((value) => ({ type: 'h', value }) as const),
  fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }).map((value) => ({ type: 't', value }) as const),
  text.map((value) => ({ type: 's', value }) as const),
  text.map((value) => ({ type: 'S', value }) as const),
  fc
    .integer({ min: 1, max: 0x10ffff })
    .filter((cp) => cp < 0xd800 || cp > 0xdfff)
    .map((cp) => ({ type: 'c', value: String.fromCodePoint(cp) }) as const),
  fc.integer({ min: 0, max: 0xffffffff }).map((value) => ({ type: 'r', value }) as const),
  fc.uint8Array({ minLength: 4, maxLength: 4 }).map((value) => ({ type: 'm', value }) as const),
  fc.uint8Array({ maxLength: 40 }).map((value) => ({ type: 'b', value }) as const),
  fc.constantFrom<OscArg>(TRUE, FALSE, { type: 'N' }, { type: 'I' }),
);

const messageArb: fc.Arbitrary<OscMessage> = fc.record({
  address: text.map((s) => `/${s}`),
  args: fc.array(argArb, { maxLength: 8 }),
});

const packetArb: fc.Arbitrary<OscPacket> = fc.letrec<{ packet: OscPacket; bundle: OscBundle }>(
  (tie) => ({
    packet: fc.oneof({ depthSize: 'small', withCrossShrink: true }, messageArb, tie('bundle')),
    bundle: fc.record({
      timetag: fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }),
      elements: fc.array(tie('packet'), { maxLength: 4 }),
    }),
  }),
).packet;

describe('round trip (property)', () => {
  it('decode(encode(message)) returns the message', () => {
    fc.assert(
      fc.property(messageArb, (msg) => {
        const bytes = encodeMessage(msg);
        expect(bytes.byteLength % 4).toBe(0);
        expect(decodePacket(bytes)).toEqual(msg);
      }),
      { numRuns: 500 },
    );
  });

  it('decode(encode(packet)) returns the packet, bundles included', () => {
    fc.assert(
      fc.property(packetArb, (packet) => {
        expect(decodePacket(encodePacket(packet))).toEqual(packet);
      }),
      { numRuns: 300 },
    );
  });

  it('encode(decode(bytes)) returns the bytes', () => {
    fc.assert(
      fc.property(packetArb, (packet) => {
        const bytes = encodePacket(packet);
        expect(encodePacket(decodePacket(bytes))).toEqual(bytes);
      }),
      { numRuns: 300 },
    );
  });

  it('never throws anything but OscDecodeError on random bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        try {
          decodePacket(bytes);
        } catch (e) {
          expect(e).toBeInstanceOf(OscDecodeError);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

// --- captured traffic -----------------------------------------------------------------

describe.each(captureFiles().map((file) => [basename(file), file]))('capture %s', (_name, file) => {
  const datagrams = receivedDatagrams(file);

  it('has datagrams to check', () => {
    expect(datagrams.length).toBeGreaterThan(100);
  });

  it('decodes every received datagram to the messages the capture tool recorded', () => {
    for (const d of datagrams) {
      const packet = decodePacket(d.raw);
      // TotalMix sends every datagram as a bundle with timetag 0 (docs/protocol/global-osc.md §1).
      expect(isBundle(packet), `line ${String(d.line)}`).toBe(true);
      if (isBundle(packet)) expect(packet.timetag).toBe(0n);
      const msgs = messagesOf(packet);
      expect(msgs.map((m) => m.address)).toEqual(d.msgs.map((m) => m.a));
      msgs.forEach((m, i) => {
        const expected = d.msgs[i]?.args ?? [];
        expect(m.args.map((a) => a.type)).toEqual(expected.map((a) => a[0]));
        m.args.forEach((a, j) => {
          const value = expected[j]?.[1];
          if (a.type === 'f') expect(a.value).toBe(Math.fround(Number(value)));
          else if (a.type === 's') expect(a.value).toBe(value);
        });
      });
    }
  });

  it('re-encodes every received datagram to the same bytes', () => {
    for (const d of datagrams) {
      expect(encodePacket(decodePacket(d.raw)), `line ${String(d.line)}`).toEqual(d.raw);
    }
  });
});
