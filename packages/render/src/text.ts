// Text as outlines: measuring, fitting into a width, and drawing as one SVG path per run.
//
// Fitting (fitText) keeps a key to the theme's few type sizes: it tries each allowed size
// from the largest, first as is and then narrowed horizontally (down to `minScaleX`), and
// only at the smallest size cuts the text with an ellipsis.

import type { Font } from './font.ts';
import { face, type FaceName } from './fonts.ts';
import { el, num } from './svg.ts';

export interface TextStyle {
  readonly face: FaceName;
  /** Font size on the key canvas (px). */
  readonly size: number;
  /** Extra space after each character, in px (negative tightens). */
  readonly tracking?: number | undefined;
  /** Every digit as wide as the widest, so changing numbers do not jitter. */
  readonly tabular?: boolean | undefined;
}

export type Anchor = 'start' | 'middle' | 'end';

interface Placed {
  readonly glyph: number;
  /** Pen position in font units. */
  readonly x: number;
  /** Extra offset to centre a tabular digit in its cell (font units). */
  readonly dx: number;
}

interface Run {
  readonly placed: readonly Placed[];
  /** Advance width in font units, tracking included. */
  readonly width: number;
}

const DIGITS = '0123456789';

const digitWidths = new WeakMap<Font, number>();

function tabularWidth(font: Font): number {
  let w = digitWidths.get(font);
  if (w === undefined) {
    w = Math.max(...Array.from(DIGITS, (d) => font.advance(font.glyphIndex(d.charCodeAt(0)))));
    digitWidths.set(font, w);
  }
  return w;
}

function layout(text: string, style: TextStyle): Run {
  const font = face(style.face);
  const units = font.unitsPerEm / style.size;
  const tracking = (style.tracking ?? 0) * units;
  const cell = style.tabular === true ? tabularWidth(font) : 0;
  const placed: Placed[] = [];
  let x = 0;
  let prev: { glyph: number; digit: boolean } | undefined;
  for (const ch of text) {
    const glyph = font.glyphIndex(ch.codePointAt(0) ?? 0);
    const digit = cell > 0 && DIGITS.includes(ch);
    if (prev && !digit && !prev.digit) x += font.kerning(prev.glyph, glyph);
    const advance = font.advance(glyph);
    placed.push({ glyph, x, dx: digit ? (cell - advance) / 2 : 0 });
    x += (digit ? cell : advance) + tracking;
    prev = { glyph, digit };
  }
  if (placed.length > 0) x -= tracking;
  return { placed, width: x };
}

/** Width of `text` in px on the key canvas. */
export function measure(text: string, style: TextStyle): number {
  return (layout(text, style).width * style.size) / face(style.face).unitsPerEm;
}

/** Height of capital letters in px, for centring text vertically. */
export function capHeight(style: Pick<TextStyle, 'face' | 'size'>): number {
  const font = face(style.face);
  return (font.capHeight * style.size) / font.unitsPerEm;
}

export interface DrawText extends TextStyle {
  readonly x: number;
  /** Baseline. */
  readonly y: number;
  readonly anchor?: Anchor | undefined;
  /** Horizontal scale, 1 = as designed. */
  readonly scaleX?: number | undefined;
  readonly fill: string;
}

const PATH_CACHE_LIMIT = 4096;
const pathCache = new Map<string, string>();

/** Path data for a line of text. Cached: keys redraw the same labels on every meter frame. */
export function textPathData(text: string, t: Omit<DrawText, 'fill'>): string {
  const anchor = t.anchor ?? 'start';
  const scaleX = t.scaleX ?? 1;
  const key = [text, t.face, t.size, t.tracking, t.tabular, t.x, t.y, anchor, scaleX].join(
    '\u0000',
  );
  const hit = pathCache.get(key);
  if (hit !== undefined) return hit;

  const font = face(t.face);
  const run = layout(text, t);
  const s = t.size / font.unitsPerEm;
  const sx = s * scaleX;
  const width = run.width * sx;
  const left = anchor === 'start' ? t.x : anchor === 'middle' ? t.x - width / 2 : t.x - width;
  let d = '';
  for (const p of run.placed) {
    const ox = left + (p.x + p.dx) * sx;
    const X = (x: number) => num(ox + x * sx);
    const Y = (y: number) => num(t.y - y * s);
    for (const seg of font.outline(p.glyph)) {
      switch (seg.op) {
        case 'M':
        case 'L':
          d += `${seg.op}${X(seg.x)} ${Y(seg.y)}`;
          break;
        case 'Q':
          d += `Q${X(seg.cx)} ${Y(seg.cy)} ${X(seg.x)} ${Y(seg.y)}`;
          break;
        case 'Z':
          d += 'Z';
          break;
      }
    }
  }
  if (pathCache.size >= PATH_CACHE_LIMIT) pathCache.clear();
  pathCache.set(key, d);
  return d;
}

/** A line of text as an SVG path ('' for empty text). */
export function text(s: string, t: DrawText): string {
  const d = textPathData(s, t);
  return d === '' ? '' : el('path', { d, fill: t.fill });
}

// --- fitting -----------------------------------------------------------------------------

export interface FitOptions {
  readonly face: FaceName;
  /** Allowed sizes, largest first. */
  readonly sizes: readonly number[];
  readonly maxWidth: number;
  /** Narrowest horizontal scale before trying the next size (default 0.8). */
  readonly minScaleX?: number | undefined;
  readonly tracking?: number | undefined;
  readonly tabular?: boolean | undefined;
}

export interface Fitted {
  /** The text to draw: the input, or a prefix of it ending in "…". */
  readonly text: string;
  readonly size: number;
  readonly scaleX: number;
  /** Drawn width in px. */
  readonly width: number;
  readonly truncated: boolean;
}

export const ELLIPSIS = '…';

// Cut text between user-perceived characters, not inside one (a letter and its accent).
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The largest allowed size (and narrowing) at which `s` fits `maxWidth`, else a cut text. */
export function fitText(s: string, o: FitOptions): Fitted {
  const minScaleX = o.minScaleX ?? 0.8;
  const sizes = o.sizes.length > 0 ? o.sizes : [12];
  const style = (size: number): TextStyle => ({
    face: o.face,
    size,
    tracking: o.tracking,
    tabular: o.tabular,
  });
  for (const size of sizes) {
    const w = measure(s, style(size));
    if (w <= o.maxWidth) return { text: s, size, scaleX: 1, width: w, truncated: false };
    if (w * minScaleX <= o.maxWidth) {
      return { text: s, size, scaleX: o.maxWidth / w, width: o.maxWidth, truncated: false };
    }
  }
  const size = sizes[sizes.length - 1] ?? 12;
  const chars = Array.from(graphemes.segment(s.trimEnd()), (g) => g.segment);
  for (let n = chars.length - 1; n >= 0; n--) {
    const cut = chars.slice(0, n).join('').trimEnd() + ELLIPSIS;
    const w = measure(cut, style(size));
    if (w * minScaleX <= o.maxWidth || n === 0) {
      const scaleX = Math.max(minScaleX, Math.min(1, o.maxWidth / w));
      return { text: cut, size, scaleX, width: w * scaleX, truncated: true };
    }
  }
  return { text: '', size, scaleX: 1, width: 0, truncated: s !== '' };
}

/** Fits and draws in one step; returns the SVG and the fitted result. */
export function fittedText(
  s: string,
  o: FitOptions & Omit<DrawText, 'size' | 'scaleX' | 'face' | 'tracking' | 'tabular'>,
): { readonly svg: string; readonly fit: Fitted } {
  const fit = fitText(s, o);
  const svg = text(fit.text, {
    face: o.face,
    size: fit.size,
    tracking: o.tracking,
    tabular: o.tabular,
    x: o.x,
    y: o.y,
    anchor: o.anchor,
    scaleX: fit.scaleX,
    fill: o.fill,
  });
  return { svg, fit };
}

/**
 * Breaks `s` into at most `maxLines` lines at spaces so that each fits `maxWidth` at `size`
 * (narrowed down to `minScaleX` if needed). Text left over goes into the last line, which
 * fitText then cuts with an ellipsis.
 */
export function wrapLines(s: string, o: FitOptions & { readonly maxLines: number }): string[] {
  const size = o.sizes[0] ?? 12;
  const minScaleX = o.minScaleX ?? 0.8;
  const fits = (line: string) =>
    measure(line, { face: o.face, size, tracking: o.tracking }) * minScaleX <= o.maxWidth;
  const words = s
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '');
  const lines: string[] = [];
  let current = '';
  for (const [i, word] of words.entries()) {
    const next = current === '' ? word : `${current} ${word}`;
    if (current === '' || fits(next)) {
      current = next;
      continue;
    }
    if (lines.length === o.maxLines - 1) {
      lines.push([current, ...words.slice(i)].join(' '));
      return lines;
    }
    lines.push(current);
    current = word;
  }
  if (current !== '') lines.push(current);
  return lines;
}

/**
 * One line if `s` fits `maxWidth` at the first size without narrowing, else two lines split at
 * the space that makes the longer line shortest ("Fireface" / "UFX III", not "Fireface UFX" /
 * "III"). A single word stays one line, for fitText to narrow or cut.
 */
export function balancedLines(s: string, o: FitOptions): string[] {
  const style: TextStyle = { face: o.face, size: o.sizes[0] ?? 12, tracking: o.tracking };
  const words = s
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '');
  const one = words.join(' ');
  if (words.length < 2 || measure(one, style) <= o.maxWidth) return [one];
  let best = [one];
  let bestWidth = Infinity;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const width = Math.max(...lines.map((line) => measure(line, style)));
    if (width < bestWidth) {
      best = lines;
      bestWidth = width;
    }
  }
  return best;
}
