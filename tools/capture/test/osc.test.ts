import { describe, expect, it } from 'vitest';
import {
  argFromJson,
  argToJson,
  decodePacket,
  encodeBundle,
  encodeMessage,
  flatten,
  float32ToNumber,
  formatMessage,
  IMMEDIATE,
  OscDecodeError,
  parseMessage,
  type OscArg,
  type OscMessage,
} from '../src/osc.ts';

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)));

function message(packet: Uint8Array): OscMessage {
  const p = decodePacket(packet);
  if (p.kind !== 'message') throw new Error('expected a message');
  return p.message;
}

describe('encodeMessage', () => {
  it('encodes /sendall 2.0 as float32 with 4-byte padding', () => {
    expect(encodeMessage({ address: '/sendall', args: [['f', 2]] })).toEqual(
      bytes('/sendall', [0, 0, 0, 0], ',f', [0, 0], [0x40, 0, 0, 0]),
    );
  });

  it('pads a string whose length is a multiple of 4 with four NULs', () => {
    expect(encodeMessage({ address: '/abc', args: [] })).toEqual(
      bytes('/abc', [0, 0, 0, 0], ',', [0, 0, 0]),
    );
  });

  it('round-trips every supported type', () => {
    const args: OscArg[] = [
      ['i', -7],
      ['f', 0.5],
      ['d', 1 / 3],
      ['s', 'Mic 9 · Vox'],
      ['S', 'sym'],
      ['b', new Uint8Array([1, 2, 3, 4, 5])],
      ['h', -(2n ** 40n)],
      ['t', 0x0123456789abcdefn],
      ['c', 'x'],
      ['r', 0xff8800ff],
      ['m', new Uint8Array([0, 0x90, 60, 100])],
      ['T'],
      ['F'],
      ['N'],
      ['I'],
    ];
    const m = { address: '/input/8/name', args };
    expect(message(encodeMessage(m))).toEqual(m);
  });
});

describe('decodePacket', () => {
  it('decodes nested bundles and flattens them in order with timetags', () => {
    const inner = encodeBundle(5n, [encodeMessage({ address: '/b', args: [['i', 2]] })]);
    const outer = encodeBundle(IMMEDIATE, [
      encodeMessage({ address: '/a', args: [['i', 1]] }),
      inner,
    ]);
    const flat = flatten(decodePacket(outer));
    expect(flat.map((m) => [m.message.address, m.timetag, m.depth])).toEqual([
      ['/a', 1n, 1],
      ['/b', 5n, 2],
    ]);
  });

  it('accepts a message without a type tag string', () => {
    expect(message(bytes('/ping', [0, 0, 0]))).toEqual({ address: '/ping', args: [] });
  });

  it('reports malformed packets with the byte offset', () => {
    const good = encodeMessage({ address: '/x', args: [['f', 1]] });
    expect(() => decodePacket(good.subarray(0, good.length - 2))).toThrow(OscDecodeError);
    expect(() => decodePacket(bytes('/x', [0, 0], ',q', [0, 0]))).toThrow(/unknown type tag "q"/);
    expect(() => decodePacket(bytes('xyz', [0]))).toThrow(/address must start/);
    expect(() => decodePacket(new Uint8Array())).toThrow(/empty packet/);
  });
});

describe('JSON form', () => {
  it('writes float32 values as their shortest decimal', () => {
    expect(float32ToNumber(Math.fround(0.1))).toBe(0.1);
    expect(float32ToNumber(Math.fround(-12.3))).toBe(-12.3);
    expect(argToJson(['f', Math.fround(0.7)])).toEqual(['f', 0.7]);
  });

  it('keeps non-finite numbers and 64-bit values as strings', () => {
    expect(argToJson(['f', -Infinity])).toEqual(['f', '-Infinity']);
    expect(argToJson(['f', NaN])).toEqual(['f', 'NaN']);
    expect(argToJson(['h', 2n ** 62n])).toEqual(['h', '4611686018427387904']);
    expect(argToJson(['t', 1n])).toEqual(['t', '0x0000000000000001']);
    expect(argToJson(['b', new Uint8Array([255, 0])])).toEqual(['b', '/wA=']);
  });

  it('reads JSON arguments back', () => {
    const args: OscArg[] = [
      ['f', -Infinity],
      ['i', 3],
      ['s', 'x'],
      ['h', 5n],
      ['b', new Uint8Array([9])],
      ['T'],
    ];
    expect(args.map((a) => argFromJson(argToJson(a)))).toEqual(args);
  });
});

describe('parseMessage / formatMessage', () => {
  it('parses the command-line form', () => {
    expect(parseMessage('/a f:1 i:2 s:"two words" T 3.5 hello')).toEqual({
      address: '/a',
      args: [['f', 1], ['i', 2], ['s', 'two words'], ['T'], ['f', 3.5], ['s', 'hello']],
    });
  });

  it('rejects bad input', () => {
    expect(() => parseMessage('sendall 1')).toThrow(/address/);
    expect(() => parseMessage('/a i:1.5')).toThrow(/integer/);
    expect(() => parseMessage('/a q:1')).toThrow(/unsupported/);
  });

  it('formats messages in the same form', () => {
    expect(
      formatMessage({ address: '/input/8/name', args: [['s', 'Mic 9'], ['f', 1], ['T']] }),
    ).toBe('/input/8/name s:"Mic 9" f:1 T');
  });
});
