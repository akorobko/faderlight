// Shared layout for function keys (toggles, snapshots, steps, banks, the recorder): a small
// title on top, one big word or symbol in the middle, a caption at the bottom. "Lit" keys
// (an active toggle, the loaded snapshot) take a tint of their colour and a frame of it.

import { mix } from '../color.ts';
import { background, CANVAS, frame, look, type KeyState, type Look } from '../parts.ts';
import { path, roundRect } from '../svg.ts';
import { fittedText } from '../text.ts';
import type { Theme } from '../theme.ts';

export const CENTER = CANVAS / 2;
export const WIDTH = CANVAS - 2 * 7;

/** Colours of a key lit in `color`: a dark tint of it, white text, a frame in it. */
export function litLook(theme: Theme, color: string): Look & { readonly frame: string } {
  const base = theme.normal.background;
  return {
    background: mix(color, base, 0.72),
    text: theme.lit.text,
    subtext: mix(color, '#ffffff', 0.55),
    offline: false,
    frame: color,
  };
}

/** Normal, lit (in `color`) or offline colours, and the frame that goes with them. */
export function functionLook(
  theme: Theme,
  s: KeyState & { readonly lit?: boolean | undefined; readonly color?: string | undefined },
): { readonly look: Look; readonly frame: string } {
  if (s.offline === true || s.lit !== true) return { look: look(theme, s), frame: '' };
  const lit = litLook(theme, s.color ?? theme.lit.frame);
  return { look: lit, frame: frame(lit.frame, 4) };
}

/** Background plus frames: the lit frame, or a dashed one while pending. */
export function chrome(
  theme: Theme,
  l: Look,
  litFrame: string,
  s: KeyState,
): { readonly under: string; readonly over: string } {
  const pending = s.pending === true && s.offline !== true;
  const over = pending
    ? frame(
        litFrame === '' ? theme.accent.pending : theme.lit.text,
        theme.frame.pending,
        theme.frame.dash,
      )
    : litFrame;
  return { under: background(theme, l), over };
}

/** A small title centred at the top. */
export function title(theme: Theme, s: string, l: Look, y = 30): string {
  return fittedText(s, {
    face: 'semibold',
    sizes: [theme.type.small],
    maxWidth: WIDTH,
    tracking: 0.6,
    x: CENTER,
    y,
    anchor: 'middle',
    fill: l.subtext,
  }).svg;
}

/** The big word in the middle. */
export function word(theme: Theme, s: string, l: Look, y = 84, sizes?: readonly number[]): string {
  return fittedText(s, {
    face: 'bold',
    sizes: sizes ?? [theme.type.large, theme.type.medium],
    maxWidth: WIDTH,
    minScaleX: 0.75,
    x: CENTER,
    y,
    anchor: 'middle',
    fill: l.text,
  }).svg;
}

/** A small caption centred at the bottom. */
export function caption(theme: Theme, s: string, l: Look, y = 122, fill?: string): string {
  if (s === '') return '';
  return fittedText(s, {
    face: 'semibold',
    sizes: [theme.type.small],
    maxWidth: WIDTH,
    tracking: 0.3,
    x: CENTER,
    y,
    anchor: 'middle',
    fill: fill ?? l.subtext,
  }).svg;
}

/** The on/off lamp at the top of a toggle: filled when on, an outline when off. */
export function lamp(on: boolean | undefined, color: string, l: Look, theme: Theme): string {
  const box = { x: CENTER - 16, y: 10, w: 32, h: 8 };
  if (on === true && !l.offline) return path(roundRect(box, 4), { fill: color });
  const outline = on === undefined ? theme.accent.pending : theme.line;
  return path(roundRect({ x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2 }, 3), {
    stroke: l.offline ? theme.offline.subtext : outline,
    strokeWidth: 2,
    dash: on === undefined ? [4, 3] : undefined,
  });
}
