// A minimal TrueType reader: character map, advance widths, glyph outlines and pair kerning.
//
// Keys draw text as outlines (SVG paths), not <text>: the Stream Deck app and the test
// rasteriser then show exactly the same pixels whatever fonts a computer has installed, and
// text can be measured for fitting. Only what that needs is read: `cmap` (formats 4 and 12),
// `hmtx`, `loca`/`glyf` (simple and composite glyphs), `OS/2` heights and `GPOS` pair
// kerning (lookup type 2, also inside type 9 extensions). No hinting, no shaping, no
// ligatures: the bundled font covers Latin, Greek and Cyrillic, which need none of that.

/** One outline segment in font units, y up. */
export type Segment =
  | { readonly op: 'M' | 'L'; readonly x: number; readonly y: number }
  | {
      readonly op: 'Q';
      readonly cx: number;
      readonly cy: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly op: 'Z' };

interface Point {
  x: number;
  y: number;
  on: boolean;
}

export interface Font {
  /** Family and subfamily from the `name` table, e.g. "Fira Sans Condensed SemiBold". */
  readonly name: string;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  /** Height of capital letters above the baseline (font units). */
  readonly capHeight: number;
  readonly numGlyphs: number;
  /** Glyph for a code point; 0 (.notdef) when the font has none. */
  glyphIndex(codePoint: number): number;
  advance(glyph: number): number;
  /** Horizontal adjustment between two glyphs (font units, usually negative). */
  kerning(left: number, right: number): number;
  outline(glyph: number): readonly Segment[];
}

export class FontError extends Error {
  override name = 'FontError';
}

// --- reading -----------------------------------------------------------------------------

class Reader {
  readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(at: number): number {
    return this.view.getUint8(at);
  }
  i8(at: number): number {
    return this.view.getInt8(at);
  }
  u16(at: number): number {
    return this.view.getUint16(at);
  }
  i16(at: number): number {
    return this.view.getInt16(at);
  }
  u32(at: number): number {
    return this.view.getUint32(at);
  }
  f2dot14(at: number): number {
    return this.view.getInt16(at) / 16384;
  }
  tag(at: number): string {
    return String.fromCharCode(this.u8(at), this.u8(at + 1), this.u8(at + 2), this.u8(at + 3));
  }
}

function tableDirectory(r: Reader): Map<string, number> {
  const version = r.u32(0);
  if (version !== 0x00010000 && version !== 0x74727565) {
    throw new FontError('Not a TrueType font (only glyf outlines are supported).');
  }
  const tables = new Map<string, number>();
  const count = r.u16(4);
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    tables.set(r.tag(rec), r.u32(rec + 8));
  }
  return tables;
}

function required(tables: Map<string, number>, tag: string): number {
  const at = tables.get(tag);
  if (at === undefined) throw new FontError(`Font has no '${tag}' table.`);
  return at;
}

// --- cmap --------------------------------------------------------------------------------

function readCmap(r: Reader, cmap: number): (codePoint: number) => number {
  const count = r.u16(cmap + 2);
  const subtables: { platform: number; encoding: number; at: number }[] = [];
  for (let i = 0; i < count; i++) {
    const rec = cmap + 4 + i * 8;
    subtables.push({ platform: r.u16(rec), encoding: r.u16(rec + 2), at: cmap + r.u32(rec + 4) });
  }
  const pick = (format: number, ok: (p: number, e: number) => boolean) =>
    subtables.find((s) => ok(s.platform, s.encoding) && r.u16(s.at) === format);
  const full = pick(12, (p, e) => (p === 3 && e === 10) || p === 0);
  if (full) return cmapFormat12(r, full.at);
  const bmp = pick(4, (p, e) => (p === 3 && (e === 1 || e === 0)) || p === 0);
  if (bmp) return cmapFormat4(r, bmp.at);
  throw new FontError('Font has no Unicode cmap (format 4 or 12).');
}

function cmapFormat4(r: Reader, at: number): (codePoint: number) => number {
  const segCount = r.u16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segCount * 2 + 2;
  const deltas = starts + segCount * 2;
  const rangeOffsets = deltas + segCount * 2;
  return (c) => {
    if (c > 0xffff) return 0;
    let lo = 0;
    let hi = segCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (r.u16(ends + mid * 2) < c) lo = mid + 1;
      else hi = mid;
    }
    const start = r.u16(starts + lo * 2);
    if (c < start || c > r.u16(ends + lo * 2)) return 0;
    const delta = r.i16(deltas + lo * 2);
    const rangeAt = rangeOffsets + lo * 2;
    const rangeOffset = r.u16(rangeAt);
    if (rangeOffset === 0) return (c + delta) & 0xffff;
    const g = r.u16(rangeAt + rangeOffset + (c - start) * 2);
    return g === 0 ? 0 : (g + delta) & 0xffff;
  };
}

function cmapFormat12(r: Reader, at: number): (codePoint: number) => number {
  const groups = r.u32(at + 12);
  const first = at + 16;
  return (c) => {
    let lo = 0;
    let hi = groups - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = first + mid * 12;
      if (c < r.u32(g)) hi = mid - 1;
      else if (c > r.u32(g + 4)) lo = mid + 1;
      else return r.u32(g + 8) + (c - r.u32(g));
    }
    return 0;
  };
}

// --- glyf --------------------------------------------------------------------------------

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME_OR_POSITIVE = 0x10;
const Y_SAME_OR_POSITIVE = 0x20;

const ARG_WORDS = 0x0001;
const ARGS_ARE_XY = 0x0002;
const HAVE_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const HAVE_XY_SCALE = 0x0040;
const HAVE_2X2 = 0x0080;

const MAX_COMPONENT_DEPTH = 8;

function readContours(r: Reader, at: number, contours: number): Point[][] {
  const endPts: number[] = [];
  for (let i = 0; i < contours; i++) endPts.push(r.u16(at + 10 + i * 2));
  const numPoints = (endPts[contours - 1] ?? -1) + 1;
  let p = at + 10 + contours * 2;
  p += 2 + r.u16(p); // instructions
  const flags: number[] = [];
  while (flags.length < numPoints) {
    const flag = r.u8(p++);
    flags.push(flag);
    if (flag & REPEAT) {
      for (let n = r.u8(p++); n > 0; n--) flags.push(flag);
    }
  }
  const coords = (short: number, same: number): number[] => {
    const out: number[] = [];
    let v = 0;
    for (const flag of flags.slice(0, numPoints)) {
      if (flag & short) {
        const d = r.u8(p++);
        v += flag & same ? d : -d;
      } else if (!(flag & same)) {
        v += r.i16(p);
        p += 2;
      }
      out.push(v);
    }
    return out;
  };
  const xs = coords(X_SHORT, X_SAME_OR_POSITIVE);
  const ys = coords(Y_SHORT, Y_SAME_OR_POSITIVE);
  const out: Point[][] = [];
  let first = 0;
  for (const end of endPts) {
    const contour: Point[] = [];
    for (let i = first; i <= end; i++) {
      contour.push({ x: xs[i] ?? 0, y: ys[i] ?? 0, on: ((flags[i] ?? 0) & ON_CURVE) !== 0 });
    }
    out.push(contour);
    first = end + 1;
  }
  return out;
}

/** TrueType quadratic contours (on- and off-curve points) to path segments. */
export function contoursToSegments(contours: readonly (readonly Point[])[]): Segment[] {
  const out: Segment[] = [];
  for (const pts of contours) {
    const n = pts.length;
    const p0 = pts[0];
    const pLast = pts[n - 1];
    if (!p0 || !pLast) continue;
    let start: { x: number; y: number };
    let seq: readonly Point[];
    if (p0.on) {
      start = p0;
      seq = pts.slice(1);
    } else if (pLast.on) {
      start = pLast;
      seq = pts.slice(0, -1);
    } else {
      start = { x: (p0.x + pLast.x) / 2, y: (p0.y + pLast.y) / 2 };
      seq = pts;
    }
    out.push({ op: 'M', x: start.x, y: start.y });
    let control: Point | undefined;
    for (const p of seq) {
      if (p.on) {
        if (control) out.push({ op: 'Q', cx: control.x, cy: control.y, x: p.x, y: p.y });
        else out.push({ op: 'L', x: p.x, y: p.y });
        control = undefined;
      } else {
        if (control) {
          const mx = (control.x + p.x) / 2;
          const my = (control.y + p.y) / 2;
          out.push({ op: 'Q', cx: control.x, cy: control.y, x: mx, y: my });
        }
        control = p;
      }
    }
    if (control) out.push({ op: 'Q', cx: control.x, cy: control.y, x: start.x, y: start.y });
    out.push({ op: 'Z' });
  }
  return out;
}

// --- GPOS pair kerning --------------------------------------------------------------------

type PairTable = (left: number, right: number) => number | undefined;

function coverageIndex(r: Reader, at: number, glyph: number): number {
  const format = r.u16(at);
  const count = r.u16(at + 2);
  if (format === 1) {
    let lo = 0;
    let hi = count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = r.u16(at + 4 + mid * 2);
      if (g < glyph) lo = mid + 1;
      else if (g > glyph) hi = mid - 1;
      else return mid;
    }
    return -1;
  }
  if (format === 2) {
    for (let i = 0; i < count; i++) {
      const rec = at + 4 + i * 6;
      if (glyph >= r.u16(rec) && glyph <= r.u16(rec + 2)) {
        return r.u16(rec + 4) + glyph - r.u16(rec);
      }
    }
  }
  return -1;
}

function glyphClass(r: Reader, at: number, glyph: number): number {
  const format = r.u16(at);
  if (format === 1) {
    const start = r.u16(at + 2);
    const count = r.u16(at + 4);
    return glyph >= start && glyph < start + count ? r.u16(at + 6 + (glyph - start) * 2) : 0;
  }
  if (format === 2) {
    const count = r.u16(at + 2);
    for (let i = 0; i < count; i++) {
      const rec = at + 4 + i * 6;
      if (glyph >= r.u16(rec) && glyph <= r.u16(rec + 2)) return r.u16(rec + 4);
    }
  }
  return 0;
}

const valueSize = (format: number): number => {
  let bits = 0;
  for (let f = format & 0xff; f; f >>= 1) bits += f & 1;
  return bits * 2;
};

/** X advance of a value record (0 when the format has none). */
function xAdvance(r: Reader, at: number, format: number): number {
  if (!(format & 0x0004)) return 0;
  let offset = 0;
  if (format & 0x0001) offset += 2;
  if (format & 0x0002) offset += 2;
  return r.i16(at + offset);
}

function pairSubtable(r: Reader, at: number): PairTable | undefined {
  const format = r.u16(at);
  const coverage = at + r.u16(at + 2);
  const vf1 = r.u16(at + 4);
  const vf2 = r.u16(at + 6);
  const size1 = valueSize(vf1);
  const recordSize = size1 + valueSize(vf2);
  if (format === 1) {
    return (left, right) => {
      const ci = coverageIndex(r, coverage, left);
      if (ci < 0 || ci >= r.u16(at + 8)) return undefined;
      const set = at + r.u16(at + 10 + ci * 2);
      const count = r.u16(set);
      let lo = 0;
      let hi = count - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const rec = set + 2 + mid * (2 + recordSize);
        const second = r.u16(rec);
        if (second < right) lo = mid + 1;
        else if (second > right) hi = mid - 1;
        else return xAdvance(r, rec + 2, vf1);
      }
      return undefined;
    };
  }
  if (format === 2) {
    const classDef1 = at + r.u16(at + 8);
    const classDef2 = at + r.u16(at + 10);
    const class1Count = r.u16(at + 12);
    const class2Count = r.u16(at + 14);
    return (left, right) => {
      if (coverageIndex(r, coverage, left) < 0) return undefined;
      const c1 = glyphClass(r, classDef1, left);
      const c2 = glyphClass(r, classDef2, right);
      if (c1 >= class1Count || c2 >= class2Count) return undefined;
      return xAdvance(r, at + 16 + (c1 * class2Count + c2) * recordSize, vf1);
    };
  }
  return undefined;
}

/** The pair-adjustment subtables of every lookup that a 'kern' feature uses, in lookup order. */
function readKerning(r: Reader, gpos: number | undefined): PairTable[][] {
  if (gpos === undefined) return [];
  const features = gpos + r.u16(gpos + 6);
  const lookups = gpos + r.u16(gpos + 8);
  const indices = new Set<number>();
  const featureCount = r.u16(features);
  for (let i = 0; i < featureCount; i++) {
    const rec = features + 2 + i * 6;
    if (r.tag(rec) !== 'kern') continue;
    const feature = features + r.u16(rec + 4);
    const n = r.u16(feature + 2);
    for (let k = 0; k < n; k++) indices.add(r.u16(feature + 4 + k * 2));
  }
  const out: PairTable[][] = [];
  for (const index of [...indices].sort((a, b) => a - b)) {
    if (index >= r.u16(lookups)) continue;
    const lookup = lookups + r.u16(lookups + 2 + index * 2);
    const type = r.u16(lookup);
    const subtables: PairTable[] = [];
    const n = r.u16(lookup + 4);
    for (let k = 0; k < n; k++) {
      let sub = lookup + r.u16(lookup + 6 + k * 2);
      let subType = type;
      if (type === 9) {
        subType = r.u16(sub + 2);
        sub += r.u32(sub + 4);
      }
      if (subType !== 2) continue;
      const table = pairSubtable(r, sub);
      if (table) subtables.push(table);
    }
    if (subtables.length > 0) out.push(subtables);
  }
  return out;
}

// --- name --------------------------------------------------------------------------------

function readName(r: Reader, at: number | undefined): string {
  if (at === undefined) return '';
  const count = r.u16(at + 2);
  const strings = at + r.u16(at + 4);
  const found = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const rec = at + 6 + i * 12;
    const platform = r.u16(rec);
    const id = r.u16(rec + 6);
    if (platform !== 3 || (id !== 1 && id !== 2 && id !== 4) || found.has(id)) continue;
    const length = r.u16(rec + 8);
    const offset = strings + r.u16(rec + 10);
    let s = '';
    for (let k = 0; k < length; k += 2) s += String.fromCharCode(r.u16(offset + k));
    found.set(id, s);
  }
  return found.get(4) ?? [found.get(1), found.get(2)].filter(Boolean).join(' ');
}

// --- font --------------------------------------------------------------------------------

/** Parses a TrueType (glyf) font file. */
export function parseFont(bytes: Uint8Array): Font {
  const r = new Reader(bytes);
  const tables = tableDirectory(r);
  const head = required(tables, 'head');
  const hhea = required(tables, 'hhea');
  const hmtx = required(tables, 'hmtx');
  const maxp = required(tables, 'maxp');
  const loca = required(tables, 'loca');
  const glyf = required(tables, 'glyf');
  const os2 = tables.get('OS/2');

  const unitsPerEm = r.u16(head + 18);
  const longLoca = r.i16(head + 50) === 1;
  const numGlyphs = r.u16(maxp + 4);
  const numberOfHMetrics = r.u16(hhea + 34);
  const ascender = r.i16(hhea + 4);
  const descender = r.i16(hhea + 6);
  const capHeight =
    os2 !== undefined && r.u16(os2) >= 2 ? r.i16(os2 + 88) : Math.round(ascender * 0.7);

  const glyphMap = readCmap(r, required(tables, 'cmap'));
  const pairTables = readKerning(r, tables.get('GPOS'));

  const glyphOffset = (g: number): [number, number] =>
    longLoca
      ? [r.u32(loca + g * 4), r.u32(loca + g * 4 + 4)]
      : [r.u16(loca + g * 2) * 2, r.u16(loca + g * 2 + 2) * 2];

  const points = (g: number, depth: number): Point[][] => {
    if (g < 0 || g >= numGlyphs || depth > MAX_COMPONENT_DEPTH) return [];
    const [start, end] = glyphOffset(g);
    if (end <= start) return [];
    const at = glyf + start;
    const contours = r.i16(at);
    if (contours >= 0) return readContours(r, at, contours);
    const out: Point[][] = [];
    let p = at + 10;
    let flags: number;
    do {
      flags = r.u16(p);
      const component = r.u16(p + 2);
      p += 4;
      let dx = 0;
      let dy = 0;
      if (flags & ARG_WORDS) {
        if (flags & ARGS_ARE_XY) [dx, dy] = [r.i16(p), r.i16(p + 2)];
        p += 4;
      } else {
        if (flags & ARGS_ARE_XY) [dx, dy] = [r.i8(p), r.i8(p + 1)];
        p += 2;
      }
      let [a, b, c, d] = [1, 0, 0, 1];
      if (flags & HAVE_SCALE) {
        a = d = r.f2dot14(p);
        p += 2;
      } else if (flags & HAVE_XY_SCALE) {
        [a, d] = [r.f2dot14(p), r.f2dot14(p + 2)];
        p += 4;
      } else if (flags & HAVE_2X2) {
        [a, b, c, d] = [r.f2dot14(p), r.f2dot14(p + 2), r.f2dot14(p + 4), r.f2dot14(p + 6)];
        p += 8;
      }
      for (const contour of points(component, depth + 1)) {
        out.push(
          contour.map((q) => ({ x: a * q.x + c * q.y + dx, y: b * q.x + d * q.y + dy, on: q.on })),
        );
      }
    } while (flags & MORE_COMPONENTS);
    return out;
  };

  const outlines = new Map<number, readonly Segment[]>();
  const kerns = new Map<number, number>();

  return {
    name: readName(r, tables.get('name')),
    unitsPerEm,
    ascender,
    descender,
    capHeight,
    numGlyphs,
    glyphIndex: glyphMap,
    advance: (g) => {
      if (g < 0 || g >= numGlyphs) return 0;
      const i = Math.min(g, numberOfHMetrics - 1);
      return r.u16(hmtx + i * 4);
    },
    kerning: (left, right) => {
      const key = left * 65536 + right;
      let v = kerns.get(key);
      if (v === undefined) {
        v = 0;
        for (const lookup of pairTables) {
          for (const table of lookup) {
            const found = table(left, right);
            if (found !== undefined) {
              v += found;
              break;
            }
          }
        }
        kerns.set(key, v);
      }
      return v;
    },
    outline: (g) => {
      let o = outlines.get(g);
      if (!o) {
        o = contoursToSegments(points(g, 0));
        outlines.set(g, o);
      }
      return o;
    },
  };
}
