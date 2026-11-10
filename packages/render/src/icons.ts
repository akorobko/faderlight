// Glyphs the font does not have, drawn as paths: arrows, transport symbols, headphones, the logo.
// Each takes a centre and a size (the height of the symbol) on the key canvas.

import { circle, num, path, polygon, rect, roundRect } from './svg.ts';

export type Direction = 'up' | 'down' | 'left' | 'right';

/** A solid triangle pointing in `direction`, `size` px from base to tip. */
export function triangle(
  cx: number,
  cy: number,
  size: number,
  direction: Direction,
  fill: string,
): string {
  const h = size / 2;
  const b = size * 0.62;
  const pts: Record<Direction, [number, number][]> = {
    up: [
      [cx, cy - h],
      [cx + b, cy + h],
      [cx - b, cy + h],
    ],
    down: [
      [cx - b, cy - h],
      [cx + b, cy - h],
      [cx, cy + h],
    ],
    left: [
      [cx - h, cy],
      [cx + h, cy - b],
      [cx + h, cy + b],
    ],
    right: [
      [cx - h, cy - b],
      [cx + h, cy],
      [cx - h, cy + b],
    ],
  };
  return path(polygon(pts[direction]), { fill });
}

export function recordDot(cx: number, cy: number, size: number, fill: string): string {
  return circle(cx, cy, size / 2, { fill });
}

export function playTriangle(cx: number, cy: number, size: number, fill: string): string {
  // Optically centred: a triangle's mass sits left of its bounding box centre.
  return triangle(cx + size * 0.06, cy, size * 0.9, 'right', fill);
}

export function stopSquare(cx: number, cy: number, size: number, fill: string): string {
  const s = size * 0.84;
  return path(roundRect({ x: cx - s / 2, y: cy - s / 2, w: s, h: s }, size * 0.08), { fill });
}

export function pauseBars(cx: number, cy: number, size: number, fill: string): string {
  const w = size * 0.3;
  const gap = size * 0.22;
  return (
    rect({ x: cx - gap / 2 - w, y: cy - size / 2, w, h: size }, { fill }, size * 0.06) +
    rect({ x: cx + gap / 2, y: cy - size / 2, w, h: size }, { fill }, size * 0.06)
  );
}

/** Headphones: a headband arc and two ear cups. */
export function headphones(cx: number, cy: number, size: number, color: string): string {
  const s = size;
  const stroke = Math.max(2, s * 0.13);
  const r = s / 2 - stroke / 2;
  const top = cy - s / 2 + stroke / 2;
  const left = cx - r;
  const right = cx + r;
  const bandY = cy + s * 0.08;
  const k = 0.5523 * r;
  // Headband: half circle from the left to the right ear (two cubic quarter curves).
  const band =
    `M${num(left)} ${num(bandY)}L${num(left)} ${num(top + r)}` +
    `C${num(left)} ${num(top + r - k)} ${num(cx - k)} ${num(top)} ${num(cx)} ${num(top)}` +
    `C${num(cx + k)} ${num(top)} ${num(right)} ${num(top + r - k)} ${num(right)} ${num(top + r)}` +
    `L${num(right)} ${num(bandY)}`;
  const cupW = s * 0.26;
  const cupH = s * 0.42;
  const cupY = cy + s / 2 - cupH;
  return (
    path(band, { stroke: color, strokeWidth: stroke }) +
    path(roundRect({ x: left - stroke / 2, y: cupY, w: cupW, h: cupH }, cupW * 0.35), {
      fill: color,
    }) +
    path(roundRect({ x: right + stroke / 2 - cupW, y: cupY, w: cupW, h: cupH }, cupW * 0.35), {
      fill: color,
    })
  );
}

/** A filled status dot. */
export function dot(cx: number, cy: number, r: number, fill: string): string {
  return circle(cx, cy, r, { fill });
}

export interface LogoColors {
  readonly track: string;
  readonly cap: string;
  readonly accent: string;
  readonly meter: string;
  readonly green: string;
  readonly yellow: string;
}

/**
 * The Faderlight mark, the plugin icon's drawing without its tile: three faders and a meter.
 * Drawn on a 194 x 152 grid, scaled to `size` px high and centred on (cx, cy).
 */
export function logo(cx: number, cy: number, size: number, c: LogoColors): string {
  const s = size / 152;
  const x0 = cx - 97 * s;
  const y0 = cy - 76 * s;
  const r = (x: number, y: number, w: number, h: number, rx: number, fill: string) =>
    rect({ x: x0 + x * s, y: y0 + y * s, w: w * s, h: h * s }, { fill }, rx * s);
  let out = '';
  for (const [i, x] of [26, 82, 138].entries()) {
    out += r(x - 5, 0, 10, 152, 5, c.track);
    out += r(x - 26, [66, 26, 88][i] ?? 66, 52, 26, 8, i === 1 ? c.accent : c.cap);
  }
  return (
    out +
    r(178, 0, 16, 152, 4, c.meter) +
    r(178, 72, 16, 80, 4, c.green) +
    r(178, 48, 16, 22, 4, c.yellow)
  );
}
