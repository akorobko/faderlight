// Minimal OSC 1.0 codec for the capture tool.
//
// The decoder is deliberately lenient and lossless: it accepts every standard
// and common non-standard type tag, keeps int64/timetag values as bigint, and
// reports exactly where a packet is malformed. The real protocol codec lives in
// packages/osc (M1.1); this one only has to read whatever TotalMix sends and
// write the handful of messages the capture scripts need.

export type OscArg =
  | readonly ['i', number]
  | readonly ['f', number]
  | readonly ['d', number]
  | readonly ['r', number]
  | readonly ['h', bigint]
  | readonly ['t', bigint]
  | readonly ['s', string]
  | readonly ['S', string]
  | readonly ['c', string]
  | readonly ['b', Uint8Array]
  | readonly ['m', Uint8Array]
  | readonly ['T']
  | readonly ['F']
  | readonly ['N']
  | readonly ['I']
  | readonly ['[']
  | readonly [']'];

export interface OscMessage {
  readonly address: string;
  readonly args: readonly OscArg[];
}

export interface OscBundle {
  readonly timetag: bigint;
  readonly elements: readonly OscPacket[];
}

export type OscPacket =
  | { readonly kind: 'message'; readonly message: OscMessage }
  | { readonly kind: 'bundle'; readonly bundle: OscBundle };

export class OscDecodeError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} at byte ${String(offset)}`);
    this.name = 'OscDecodeError';
    this.offset = offset;
  }
}

/** OSC timetag 1 ("immediately"). */
export const IMMEDIATE = 1n;

const BUNDLE_HEADER = '#bundle';
const utf8 = new TextDecoder('utf-8', { fatal: false });
const utf8Encoder = new TextEncoder();

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readString(
  bytes: Uint8Array,
  offset: number,
  end: number,
): { value: string; next: number } {
  let zero = offset;
  while (zero < end && bytes[zero] !== 0) zero++;
  if (zero >= end) throw new OscDecodeError('unterminated string', offset);
  const next = pad4(zero + 1);
  if (next > end) throw new OscDecodeError('string padding runs past the end', offset);
  return { value: utf8.decode(bytes.subarray(offset, zero)), next };
}

function need(offset: number, size: number, end: number, what: string): void {
  if (offset + size > end) throw new OscDecodeError(`truncated ${what}`, offset);
}

function decodeMessage(bytes: Uint8Array, start: number, end: number): OscMessage {
  const dv = view(bytes);
  const address = readString(bytes, start, end);
  if (!address.value.startsWith('/')) {
    throw new OscDecodeError(
      `address must start with "/" (got ${JSON.stringify(address.value)})`,
      start,
    );
  }
  // Some senders omit the type tag string entirely; treat that as "no arguments".
  if (address.next >= end) return { address: address.value, args: [] };
  const tags = readString(bytes, address.next, end);
  if (!tags.value.startsWith(',')) {
    throw new OscDecodeError(
      `type tag string must start with "," (got ${JSON.stringify(tags.value)})`,
      address.next,
    );
  }
  const args: OscArg[] = [];
  let p = tags.next;
  for (const tag of tags.value.slice(1)) {
    switch (tag) {
      case 'i':
        need(p, 4, end, 'int32');
        args.push(['i', dv.getInt32(p)]);
        p += 4;
        break;
      case 'f':
        need(p, 4, end, 'float32');
        args.push(['f', dv.getFloat32(p)]);
        p += 4;
        break;
      case 'r':
        need(p, 4, end, 'rgba');
        args.push(['r', dv.getUint32(p)]);
        p += 4;
        break;
      case 'c':
        need(p, 4, end, 'char');
        args.push(['c', String.fromCodePoint(dv.getUint32(p))]);
        p += 4;
        break;
      case 'm':
        need(p, 4, end, 'midi');
        args.push(['m', bytes.slice(p, p + 4)]);
        p += 4;
        break;
      case 'd':
        need(p, 8, end, 'float64');
        args.push(['d', dv.getFloat64(p)]);
        p += 8;
        break;
      case 'h':
        need(p, 8, end, 'int64');
        args.push(['h', dv.getBigInt64(p)]);
        p += 8;
        break;
      case 't':
        need(p, 8, end, 'timetag');
        args.push(['t', dv.getBigUint64(p)]);
        p += 8;
        break;
      case 's':
      case 'S': {
        const s = readString(bytes, p, end);
        args.push([tag, s.value]);
        p = s.next;
        break;
      }
      case 'b': {
        need(p, 4, end, 'blob size');
        const size = dv.getInt32(p);
        if (size < 0) throw new OscDecodeError('negative blob size', p);
        need(p + 4, size, end, 'blob');
        args.push(['b', bytes.slice(p + 4, p + 4 + size)]);
        p = pad4(p + 4 + size);
        break;
      }
      case 'T':
      case 'F':
      case 'N':
      case 'I':
      case '[':
      case ']':
        args.push([tag]);
        break;
      default:
        throw new OscDecodeError(`unknown type tag ${JSON.stringify(tag)}`, tags.next);
    }
  }
  return { address: address.value, args };
}

function decodeAt(bytes: Uint8Array, start: number, end: number, depth: number): OscPacket {
  if (depth > 8) throw new OscDecodeError('bundles nested too deeply', start);
  if (bytes[start] === 0x23 /* # */) {
    const header = readString(bytes, start, end);
    if (header.value !== BUNDLE_HEADER) {
      throw new OscDecodeError(`unknown packet header ${JSON.stringify(header.value)}`, start);
    }
    need(header.next, 8, end, 'bundle timetag');
    const dv = view(bytes);
    const timetag = dv.getBigUint64(header.next);
    const elements: OscPacket[] = [];
    let p = header.next + 8;
    while (p < end) {
      need(p, 4, end, 'bundle element size');
      const size = dv.getInt32(p);
      if (size <= 0 || size % 4 !== 0)
        throw new OscDecodeError(`bad bundle element size ${String(size)}`, p);
      need(p + 4, size, end, 'bundle element');
      elements.push(decodeAt(bytes, p + 4, p + 4 + size, depth + 1));
      p += 4 + size;
    }
    return { kind: 'bundle', bundle: { timetag, elements } };
  }
  return { kind: 'message', message: decodeMessage(bytes, start, end) };
}

/** Decodes one UDP datagram (a message or a bundle). Throws OscDecodeError. */
export function decodePacket(bytes: Uint8Array): OscPacket {
  if (bytes.byteLength === 0) throw new OscDecodeError('empty packet', 0);
  // OSC packets should be 4-byte aligned; decode unaligned ones anyway; the raw bytes are recorded.
  return decodeAt(bytes, 0, bytes.byteLength, 0);
}

export interface FlatMessage {
  readonly message: OscMessage;
  /** Timetag of the innermost enclosing bundle; undefined for a bare message. */
  readonly timetag?: bigint;
  /** Bundle nesting depth (0 = bare message, 1 = inside a top-level bundle). */
  readonly depth: number;
}

/** Flattens bundles into the list of messages they carry, in order. */
export function flatten(packet: OscPacket): FlatMessage[] {
  const out: FlatMessage[] = [];
  const walk = (p: OscPacket, depth: number, timetag: bigint | undefined): void => {
    if (p.kind === 'message') {
      out.push(
        timetag === undefined
          ? { message: p.message, depth }
          : { message: p.message, timetag, depth },
      );
      return;
    }
    for (const e of p.bundle.elements) walk(e, depth + 1, p.bundle.timetag);
  };
  walk(packet, 0, undefined);
  return out;
}

// ---------------------------------------------------------------------------
// Encoding

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
  }

  string(value: string): void {
    const text = utf8Encoder.encode(value);
    const out = new Uint8Array(pad4(text.byteLength + 1));
    out.set(text);
    this.push(out);
  }

  u32(fn: (dv: DataView) => void, size: 4 | 8): void {
    const out = new Uint8Array(size);
    fn(view(out));
    this.push(out);
  }

  blob(bytes: Uint8Array): void {
    this.u32((dv) => {
      dv.setInt32(0, bytes.byteLength);
    }, 4);
    const out = new Uint8Array(pad4(bytes.byteLength));
    out.set(bytes);
    this.push(out);
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let p = 0;
    for (const c of this.chunks) {
      out.set(c, p);
      p += c.byteLength;
    }
    return out;
  }
}

/** Encodes one OSC message. */
export function encodeMessage(message: OscMessage): Uint8Array {
  if (!message.address.startsWith('/'))
    throw new Error(`OSC address must start with "/": ${message.address}`);
  const w = new Writer();
  w.string(message.address);
  w.string(',' + message.args.map((a) => a[0]).join(''));
  for (const arg of message.args) {
    switch (arg[0]) {
      case 'i': {
        const v = arg[1];
        w.u32((dv) => {
          dv.setInt32(0, v);
        }, 4);
        break;
      }
      case 'f': {
        const v = arg[1];
        w.u32((dv) => {
          dv.setFloat32(0, v);
        }, 4);
        break;
      }
      case 'r': {
        const v = arg[1];
        w.u32((dv) => {
          dv.setUint32(0, v);
        }, 4);
        break;
      }
      case 'c': {
        const v = arg[1].codePointAt(0) ?? 0;
        w.u32((dv) => {
          dv.setUint32(0, v);
        }, 4);
        break;
      }
      case 'm': {
        const out = new Uint8Array(4);
        out.set(arg[1].subarray(0, 4));
        w.push(out);
        break;
      }
      case 'd': {
        const v = arg[1];
        w.u32((dv) => {
          dv.setFloat64(0, v);
        }, 8);
        break;
      }
      case 'h': {
        const v = arg[1];
        w.u32((dv) => {
          dv.setBigInt64(0, v);
        }, 8);
        break;
      }
      case 't': {
        const v = arg[1];
        w.u32((dv) => {
          dv.setBigUint64(0, v);
        }, 8);
        break;
      }
      case 's':
      case 'S':
        w.string(arg[1]);
        break;
      case 'b':
        w.blob(arg[1]);
        break;
      case 'T':
      case 'F':
      case 'N':
      case 'I':
      case '[':
      case ']':
        break;
    }
  }
  return w.bytes();
}

/** Encodes a bundle of already-encoded elements (messages or bundles). */
export function encodeBundle(timetag: bigint, elements: readonly Uint8Array[]): Uint8Array {
  const w = new Writer();
  w.string(BUNDLE_HEADER);
  w.u32((dv) => {
    dv.setBigUint64(0, timetag);
  }, 8);
  for (const e of elements) w.blob(e);
  return w.bytes();
}

// ---------------------------------------------------------------------------
// JSON form used in capture files: every argument is a [tag] or [tag, value] tuple.

export type JsonArg = readonly [string] | readonly [string, number | string];

/** Shortest decimal that reads back as the same float32 (e.g. 0.1f -> 0.1, not 0.10000000149). */
export function float32ToNumber(v: number): number {
  if (!Number.isFinite(v) || Number.isInteger(v)) return v;
  for (let p = 1; p <= 9; p++) {
    const n = Number(v.toPrecision(p));
    if (Math.fround(n) === v) return n;
  }
  return v;
}

function jsonNumber(v: number): number | string {
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return 'Infinity';
  if (v === -Infinity) return '-Infinity';
  return v;
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

export function argToJson(arg: OscArg): JsonArg {
  switch (arg[0]) {
    case 'f':
      return ['f', jsonNumber(float32ToNumber(arg[1]))];
    case 'i':
    case 'r':
    case 'd':
      return [arg[0], jsonNumber(arg[1])];
    case 'h':
      return ['h', arg[1].toString()];
    case 't':
      return ['t', '0x' + arg[1].toString(16).padStart(16, '0')];
    case 's':
    case 'S':
    case 'c':
      return [arg[0], arg[1]];
    case 'b':
    case 'm':
      return [arg[0], base64(arg[1])];
    case 'T':
    case 'F':
    case 'N':
    case 'I':
    case '[':
    case ']':
      return [arg[0]];
  }
}

/** Reads a JSON argument back into an OscArg (inverse of argToJson for the common tags). */
export function argFromJson(json: JsonArg): OscArg {
  const [tag, raw] = json;
  const num = (): number => {
    if (typeof raw === 'number') return raw;
    if (raw === 'NaN') return NaN;
    if (raw === 'Infinity') return Infinity;
    if (raw === '-Infinity') return -Infinity;
    throw new Error(`expected a number for tag ${tag}`);
  };
  const str = (): string => {
    if (typeof raw !== 'string') throw new Error(`expected a string for tag ${tag}`);
    return raw;
  };
  switch (tag) {
    case 'i':
    case 'f':
    case 'd':
    case 'r':
      return [tag, num()];
    case 'h':
      return ['h', BigInt(str())];
    case 't':
      return ['t', BigInt(str())];
    case 's':
    case 'S':
    case 'c':
      return [tag, str()];
    case 'b':
    case 'm':
      return [tag, new Uint8Array(Buffer.from(str(), 'base64'))];
    case 'T':
    case 'F':
    case 'N':
    case 'I':
    case '[':
    case ']':
      return [tag];
    default:
      throw new Error(`unknown type tag ${tag}`);
  }
}

/** Numeric reading of an argument (T/F as 1/0), or undefined for non-numeric args. */
export function argNumber(arg: OscArg | undefined): number | undefined {
  if (arg === undefined) return undefined;
  switch (arg[0]) {
    case 'i':
    case 'f':
    case 'd':
      return arg[1];
    case 'T':
      return 1;
    case 'F':
      return 0;
    default:
      return undefined;
  }
}

/** Human-readable one-line form, e.g. `/input/8/mute f:1`. */
export function formatMessage(message: OscMessage): string {
  const args = message.args.map((a) => {
    const j = argToJson(a);
    return j.length === 1
      ? j[0]
      : `${j[0]}:${typeof j[1] === 'string' && (a[0] === 's' || a[0] === 'S') ? JSON.stringify(j[1]) : String(j[1])}`;
  });
  return [message.address, ...args].join(' ');
}

/**
 * Parses the command-line form of a message: `/address f:1 i:2 s:"two words" T F`.
 * A bare number is a float (TotalMix expects float32 for numeric commands); any other bare
 * token is a string.
 */
export function parseMessage(text: string): OscMessage {
  const tokens: string[] = [];
  const re = /(?:[^\s"]+|"[^"]*")+/g;
  for (const m of text.matchAll(re)) tokens.push(m[0]);
  const [address, ...rest] = tokens;
  if (address?.startsWith('/') !== true)
    throw new Error(`message must start with an address: ${text}`);
  const unquote = (s: string): string =>
    s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
  const args = rest.map((tok): OscArg => {
    if (tok === 'T' || tok === 'F' || tok === 'N' || tok === 'I') return [tok];
    const colon = tok.indexOf(':');
    if (colon === 1) {
      const tag = tok[0];
      const value = unquote(tok.slice(2));
      switch (tag) {
        case 'f':
        case 'i':
        case 'd': {
          const n = Number(value);
          if (value === '' || Number.isNaN(n)) throw new Error(`not a number: ${tok}`);
          if (tag === 'i' && !Number.isInteger(n)) throw new Error(`not an integer: ${tok}`);
          return [tag, n];
        }
        case 's':
          return ['s', value];
        default:
          throw new Error(`unsupported argument type in ${tok} (use f:, i:, d:, s:, T, F)`);
      }
    }
    const n = Number(tok);
    if (tok !== '' && !Number.isNaN(n)) return ['f', n];
    return ['s', unquote(tok)];
  });
  return { address, args };
}

/** Raw-bytes helper used by tests and the summary tool. */
export function toBase64(bytes: Uint8Array): string {
  return base64(bytes);
}
