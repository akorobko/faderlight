// OSC 1.0 binary codec: messages and (nested) bundles, big-endian, 4-byte aligned.

import { isBundle, type OscArg, type OscBundle, type OscMessage, type OscPacket } from './types.ts';

export class OscDecodeError extends Error {
  /** Byte offset in the datagram where decoding failed. */
  readonly offset: number;

  constructor(reason: string, offset: number) {
    super(`${reason} at byte ${String(offset)}`);
    this.name = 'OscDecodeError';
    this.offset = offset;
  }
}

const BUNDLE_TAG = '#bundle';
const MAX_DEPTH = 8;
const utf8Decoder = new TextDecoder('utf-8');
const utf8Encoder = new TextEncoder();

const pad4 = (n: number): number => (n + 3) & ~3;

// --- decoding -------------------------------------------------------------------------

class Reader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  need(offset: number, size: number, end: number, what: string): void {
    if (offset + size > end) throw new OscDecodeError(`truncated ${what}`, offset);
  }

  string(offset: number, end: number): { value: string; next: number } {
    let zero = offset;
    while (zero < end && this.bytes[zero] !== 0) zero++;
    if (zero >= end) throw new OscDecodeError('unterminated string', offset);
    const next = pad4(zero + 1);
    if (next > end) throw new OscDecodeError('string padding runs past the end', offset);
    return { value: utf8Decoder.decode(this.bytes.subarray(offset, zero)), next };
  }

  int32(o: number): number {
    return this.view.getInt32(o);
  }
  uint32(o: number): number {
    return this.view.getUint32(o);
  }
  float32(o: number): number {
    return this.view.getFloat32(o);
  }
  float64(o: number): number {
    return this.view.getFloat64(o);
  }
  int64(o: number): bigint {
    return this.view.getBigInt64(o);
  }
  uint64(o: number): bigint {
    return this.view.getBigUint64(o);
  }
}

function decodeMessage(r: Reader, start: number, end: number): OscMessage {
  const address = r.string(start, end);
  if (!address.value.startsWith('/')) {
    throw new OscDecodeError(
      `address must start with "/", got ${JSON.stringify(address.value)}`,
      start,
    );
  }
  // Very old senders omit the type tag string: read that as "no arguments".
  if (address.next >= end) return { address: address.value, args: [] };
  const tags = r.string(address.next, end);
  if (!tags.value.startsWith(',')) {
    throw new OscDecodeError(
      `type tag string must start with ",", got ${JSON.stringify(tags.value)}`,
      address.next,
    );
  }
  const args: OscArg[] = [];
  let p = tags.next;
  for (const tag of tags.value.slice(1)) {
    switch (tag) {
      case 'i':
        r.need(p, 4, end, 'int32');
        args.push({ type: 'i', value: r.int32(p) });
        p += 4;
        break;
      case 'f':
        r.need(p, 4, end, 'float32');
        args.push({ type: 'f', value: r.float32(p) });
        p += 4;
        break;
      case 'r':
        r.need(p, 4, end, 'RGBA colour');
        args.push({ type: 'r', value: r.uint32(p) });
        p += 4;
        break;
      case 'c':
        r.need(p, 4, end, 'char');
        args.push({ type: 'c', value: String.fromCodePoint(r.uint32(p)) });
        p += 4;
        break;
      case 'm':
        r.need(p, 4, end, 'MIDI message');
        args.push({ type: 'm', value: r.bytes.slice(p, p + 4) });
        p += 4;
        break;
      case 'd':
        r.need(p, 8, end, 'float64');
        args.push({ type: 'd', value: r.float64(p) });
        p += 8;
        break;
      case 'h':
        r.need(p, 8, end, 'int64');
        args.push({ type: 'h', value: r.int64(p) });
        p += 8;
        break;
      case 't':
        r.need(p, 8, end, 'timetag');
        args.push({ type: 't', value: r.uint64(p) });
        p += 8;
        break;
      case 's':
      case 'S': {
        const s = r.string(p, end);
        args.push({ type: tag, value: s.value });
        p = s.next;
        break;
      }
      case 'b': {
        r.need(p, 4, end, 'blob size');
        const size = r.int32(p);
        if (size < 0) throw new OscDecodeError('negative blob size', p);
        r.need(p + 4, size, end, 'blob');
        args.push({ type: 'b', value: r.bytes.slice(p + 4, p + 4 + size) });
        p = pad4(p + 4 + size);
        if (p > end) throw new OscDecodeError('blob padding runs past the end', p);
        break;
      }
      case 'T':
      case 'F':
      case 'N':
      case 'I':
        args.push({ type: tag });
        break;
      default:
        throw new OscDecodeError(`unsupported type tag ${JSON.stringify(tag)}`, address.next);
    }
  }
  return { address: address.value, args };
}

function decodeAt(r: Reader, start: number, end: number, depth: number): OscPacket {
  if (r.bytes[start] !== 0x23 /* # */) return decodeMessage(r, start, end);
  if (depth >= MAX_DEPTH) throw new OscDecodeError('bundles nested too deeply', start);
  const header = r.string(start, end);
  if (header.value !== BUNDLE_TAG) {
    throw new OscDecodeError(`unknown packet header ${JSON.stringify(header.value)}`, start);
  }
  r.need(header.next, 8, end, 'bundle timetag');
  const timetag = r.uint64(header.next);
  const elements: OscPacket[] = [];
  let p = header.next + 8;
  while (p < end) {
    r.need(p, 4, end, 'bundle element size');
    const size = r.int32(p);
    if (size <= 0 || size % 4 !== 0) {
      throw new OscDecodeError(`bad bundle element size ${String(size)}`, p);
    }
    r.need(p + 4, size, end, 'bundle element');
    elements.push(decodeAt(r, p + 4, p + 4 + size, depth + 1));
    p += 4 + size;
  }
  return { timetag, elements };
}

/** Decodes one datagram (a message or a bundle). Throws OscDecodeError on malformed input. */
export function decodePacket(bytes: Uint8Array): OscPacket {
  if (bytes.byteLength === 0) throw new OscDecodeError('empty packet', 0);
  return decodeAt(new Reader(bytes), 0, bytes.byteLength, 0);
}

// --- encoding -------------------------------------------------------------------------

function checkString(value: string, what: string): Uint8Array {
  if (value.includes('\0')) throw new TypeError(`OSC ${what} must not contain NUL characters`);
  return utf8Encoder.encode(value);
}

function argSize(arg: OscArg, text: Uint8Array | undefined): number {
  switch (arg.type) {
    case 'i':
    case 'f':
    case 'r':
    case 'c':
    case 'm':
      return 4;
    case 'd':
    case 'h':
    case 't':
      return 8;
    case 's':
    case 'S':
      return pad4((text?.byteLength ?? 0) + 1);
    case 'b':
      return 4 + pad4(arg.value.byteLength);
    case 'T':
    case 'F':
    case 'N':
    case 'I':
      return 0;
  }
}

function checkArg(arg: OscArg): void {
  switch (arg.type) {
    case 'i':
      if (!Number.isInteger(arg.value) || arg.value < -0x80000000 || arg.value > 0x7fffffff) {
        throw new RangeError(`OSC int32 out of range: ${String(arg.value)}`);
      }
      break;
    case 'r':
      if (!Number.isInteger(arg.value) || arg.value < 0 || arg.value > 0xffffffff) {
        throw new RangeError(`OSC RGBA value out of range: ${String(arg.value)}`);
      }
      break;
    case 'c':
      if (arg.value === '' || String.fromCodePoint(arg.value.codePointAt(0) ?? 0) !== arg.value) {
        throw new RangeError('OSC char must be one character');
      }
      break;
    case 'm':
      if (arg.value.byteLength !== 4) throw new RangeError('OSC MIDI message must be 4 bytes');
      break;
    case 'h':
      if (arg.value < -(1n << 63n) || arg.value >= 1n << 63n) {
        throw new RangeError('OSC int64 out of range');
      }
      break;
    case 't':
      if (arg.value < 0n || arg.value >= 1n << 64n)
        throw new RangeError('OSC timetag out of range');
      break;
    default:
      break;
  }
}

class Writer {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private p = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  raw(data: Uint8Array): void {
    this.bytes.set(data, this.p);
    this.p += data.byteLength;
  }

  /** Text plus NUL terminator and zero padding to a multiple of 4. */
  text(data: Uint8Array): void {
    this.bytes.set(data, this.p);
    this.p += pad4(data.byteLength + 1);
  }

  int32(v: number): void {
    this.view.setInt32(this.p, v);
    this.p += 4;
  }
  uint32(v: number): void {
    this.view.setUint32(this.p, v);
    this.p += 4;
  }
  float32(v: number): void {
    this.view.setFloat32(this.p, v);
    this.p += 4;
  }
  float64(v: number): void {
    this.view.setFloat64(this.p, v);
    this.p += 8;
  }
  int64(v: bigint): void {
    this.view.setBigInt64(this.p, v);
    this.p += 8;
  }
  uint64(v: bigint): void {
    this.view.setBigUint64(this.p, v);
    this.p += 8;
  }
  skip(n: number): void {
    this.p += n;
  }
}

/** Encodes one message. Throws on an invalid address or out-of-range argument. */
export function encodeMessage(msg: OscMessage): Uint8Array {
  if (!msg.address.startsWith('/')) {
    throw new TypeError(`OSC address must start with "/": ${JSON.stringify(msg.address)}`);
  }
  const address = checkString(msg.address, 'address');
  const tags = utf8Encoder.encode(',' + msg.args.map((a) => a.type).join(''));
  const texts = msg.args.map((a) =>
    a.type === 's' || a.type === 'S' ? checkString(a.value, 'string') : undefined,
  );
  let size = pad4(address.byteLength + 1) + pad4(tags.byteLength + 1);
  msg.args.forEach((a, i) => {
    checkArg(a);
    size += argSize(a, texts[i]);
  });

  const w = new Writer(size);
  w.text(address);
  w.text(tags);
  msg.args.forEach((a, i) => {
    switch (a.type) {
      case 'i':
        w.int32(a.value);
        break;
      case 'f':
        w.float32(a.value);
        break;
      case 'r':
        w.uint32(a.value);
        break;
      case 'c':
        w.uint32(a.value.codePointAt(0) ?? 0);
        break;
      case 'm':
        w.raw(a.value);
        break;
      case 'd':
        w.float64(a.value);
        break;
      case 'h':
        w.int64(a.value);
        break;
      case 't':
        w.uint64(a.value);
        break;
      case 's':
      case 'S':
        w.text(texts[i] ?? new Uint8Array());
        break;
      case 'b':
        w.int32(a.value.byteLength);
        w.raw(a.value);
        w.skip(pad4(a.value.byteLength) - a.value.byteLength);
        break;
      case 'T':
      case 'F':
      case 'N':
      case 'I':
        break;
    }
  });
  return w.bytes;
}

const BUNDLE_HEADER = utf8Encoder.encode(BUNDLE_TAG);

/** Encodes a bundle; elements may be messages or bundles. */
export function encodeBundle(b: OscBundle): Uint8Array {
  if (b.timetag < 0n || b.timetag >= 1n << 64n) throw new RangeError('OSC timetag out of range');
  const parts = b.elements.map(encodePacket);
  const size = 16 + parts.reduce((n, part) => n + 4 + part.byteLength, 0);
  const w = new Writer(size);
  w.text(BUNDLE_HEADER);
  w.uint64(b.timetag);
  for (const part of parts) {
    w.int32(part.byteLength);
    w.raw(part);
  }
  return w.bytes;
}

/** Encodes a message or a bundle. */
export function encodePacket(packet: OscPacket): Uint8Array {
  return isBundle(packet) ? encodeBundle(packet) : encodeMessage(packet);
}
