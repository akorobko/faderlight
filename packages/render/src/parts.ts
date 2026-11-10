// Shared key parts: the key's look per state (background, the tinted pad, the pending frame,
// offline hatching), chips (the M and S letters, DIM) and badges (48V, Ø, INST: filled when
// on, outlined when off).

import { mix } from './color.ts';
import type { FaceName } from './fonts.ts';
import { line, num, path, rect, roundRect, type Box } from './svg.ts';
import { capHeight, measure, text } from './text.ts';
import type { StateTokens, Theme } from './theme.ts';

export const CANVAS = 144;

/**
 * Margin around the content canvas that only the key's background reaches. The Stream Deck's
 * keycaps bend the outer part of each display, so text, values and meters stay on the
 * 144 x 144 content canvas and the key shows it inside this margin (`renderKey` draws a
 * viewBox of `KEY` on the full key).
 */
export const BLEED = 14;

/** The whole key, margin included, in content canvas coordinates. */
export const KEY: Box = { x: -BLEED, y: -BLEED, w: CANVAS + 2 * BLEED, h: CANVAS + 2 * BLEED };

/**
 * Where a state's colour goes (muted, soloed, lit): the content canvas and 3 px of the margin,
 * with round corners. Colour that reaches the key's edge bends under the keycap into odd
 * shapes, so the edge always keeps the plain background.
 */
export const PAD: Box = { x: -3, y: -3, w: CANVAS + 6, h: CANVAS + 6 };
export const PAD_RADIUS = 13;

/** Flags every key can carry. */
export interface KeyState {
  /** The mixer is not reachable: grey, hatched, no values. */
  readonly offline?: boolean | undefined;
  /** Sent, not confirmed by the mixer yet: dashed frame. */
  readonly pending?: boolean | undefined;
}

export interface Look extends StateTokens {
  readonly offline: boolean;
}

/** Colours for a key: offline wins over muted, muted over soloed, soloed over normal. */
export function look(
  theme: Theme,
  s: KeyState & { readonly muted?: boolean | undefined; readonly soloed?: boolean | undefined },
): Look {
  if (s.offline === true) return { ...theme.offline, offline: true };
  if (s.muted === true) return { ...theme.muted, offline: false };
  if (s.soloed === true) return { ...theme.soloed, offline: false };
  return { ...theme.normal, offline: false };
}

/**
 * The key's background: the plain background to the edge, and the look's own colour (or
 * `fill`) on the pad when it differs. Offline: grey with diagonal hatching.
 */
export function background(theme: Theme, l: Look | StateTokens, fill?: string): string {
  if ('offline' in l && l.offline) {
    return rect(KEY, { fill: fill ?? l.background }) + hatch(theme.offline.hatch);
  }
  const base = theme.normal.background;
  const tint = fill ?? l.background;
  let out = rect(KEY, { fill: base });
  if (tint !== base) out += rect(PAD, { fill: tint }, PAD_RADIUS);
  return out;
}

/** Diagonal stripes over the whole key. */
export function hatch(color: string, spacing = 20, width = 6): string {
  const size = KEY.w;
  let d = '';
  for (let c = spacing / 2; c < 2 * size; c += spacing) {
    const x1 = Math.max(0, c - size);
    const x2 = Math.min(c, size);
    d += `M${num(KEY.x + x1)} ${num(KEY.y + c - x1)}L${num(KEY.x + x2)} ${num(KEY.y + c - x2)}`;
  }
  return path(d, { stroke: color, strokeWidth: width });
}

/** A frame along the inside of the pad's edge: dashed while a change is pending. */
export function frame(color: string, width: number, dash?: readonly number[]): string {
  const inset = width / 2;
  const box = { x: PAD.x + inset, y: PAD.y + inset, w: PAD.w - 2 * inset, h: PAD.h - 2 * inset };
  return path(roundRect(box, PAD_RADIUS - inset), { stroke: color, strokeWidth: width, dash });
}

/**
 * The frame a channel-like key needs: a dashed one while a change is pending, orange when
 * the channel is soloed. Solo itself is the pad's colour and the S chip.
 */
export function stateFrames(
  theme: Theme,
  s: KeyState & { readonly soloed?: boolean | undefined },
): string {
  if (s.offline === true || s.pending !== true) return '';
  return frame(
    s.soloed === true ? theme.accent.solo : theme.accent.pending,
    theme.frame.pending,
    theme.frame.dash,
  );
}

// --- chips and badges ----------------------------------------------------------------------

export interface ChipStyle {
  readonly fill: string;
  readonly ink: string;
  /** Outline only (an off badge). */
  readonly outline?: boolean | undefined;
  readonly size: number;
  readonly height: number;
  readonly face?: FaceName | undefined;
}

const CHIP_PAD = 4;

export function chipWidth(label: string, s: ChipStyle): number {
  const w = measure(label, { face: s.face ?? 'bold', size: s.size }) + 2 * CHIP_PAD;
  return Math.max(s.height, Math.ceil(w));
}

/** A rounded label: filled (fill colour, ink text) or outlined (fill as the outline). */
export function chip(label: string, x: number, y: number, s: ChipStyle): string {
  const w = chipWidth(label, s);
  const box: Box = { x, y, w, h: s.height };
  const r = Math.min(5, s.height / 2);
  const fill = s.outline === true ? undefined : s.fill;
  const body =
    s.outline === true
      ? path(roundRect({ x: x + 1, y: y + 1, w: w - 2, h: s.height - 2 }, r - 1), {
          stroke: s.fill,
          strokeWidth: 2,
        })
      : path(roundRect(box, r), { fill });
  const face = s.face ?? 'bold';
  const baseline = y + s.height / 2 + capHeight({ face, size: s.size }) / 2;
  return (
    body +
    text(label, { face, size: s.size, x: x + w / 2, y: baseline, anchor: 'middle', fill: s.ink })
  );
}

export interface Placed {
  readonly label: string;
  readonly style: ChipStyle;
}

/**
 * Lays chips out left to right from `x`, `gap` apart, until `maxWidth`. Chips that do not
 * fit are dropped and an ellipsis chip says so.
 */
export function chipRow(
  items: readonly Placed[],
  x: number,
  y: number,
  maxWidth: number,
  gap: number,
  overflow: ChipStyle,
): string {
  let shown = items;
  if (chipsWidth(items, gap) > maxWidth) {
    const room = maxWidth - gap - chipWidth('…', overflow);
    let n = items.length - 1;
    while (n > 0 && chipsWidth(items.slice(0, n), gap) > room) n--;
    shown = [...items.slice(0, n), { label: '…', style: overflow }];
  }
  let out = '';
  let cx = x;
  for (const item of shown) {
    out += chip(item.label, cx, y, item.style);
    cx += chipWidth(item.label, item.style) + gap;
  }
  return out;
}

/** Same chips right-aligned to `right`, laid out right to left. */
export function chipsRightAligned(
  items: readonly Placed[],
  right: number,
  y: number,
  gap: number,
): string {
  let out = '';
  let cx = right;
  for (const item of items) {
    const w = chipWidth(item.label, item.style);
    cx -= w;
    out += chip(item.label, cx, y, item.style);
    cx -= gap;
  }
  return out;
}

/** Total width of chips laid out with `gap`. */
export function chipsWidth(items: readonly Placed[], gap: number): number {
  return items.reduce((w, item, i) => w + chipWidth(item.label, item.style) + (i > 0 ? gap : 0), 0);
}

// --- small helpers -------------------------------------------------------------------------

/** A thin separator line. */
export function rule(x1: number, x2: number, y: number, color: string): string {
  return line(x1, y, x2, y, { stroke: color, strokeWidth: 2 });
}

/** Dims a colour towards a background (for muted or inactive parts). */
export function dimmed(color: string, backgroundColor: string, amount: number): string {
  return amount > 0 ? mix(color, backgroundColor, amount) : color;
}
