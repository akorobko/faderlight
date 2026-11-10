// Level meter bar: clip cap on top, then a vertical bar from the theme's floor (−60 dBFS by
// default) to 0 dBFS, coloured by zone (green, yellow from −18, orange from −6, red from −1),
// with a peak-hold tick. The unlit part shows the zones dimmed, so the scale reads even when
// the channel is silent.

import { mix } from './color.ts';
import { rect, type Box } from './svg.ts';
import type { Theme } from './theme.ts';

/** One channel's meter: latest level, held peak (both dBFS) and a latched clip. */
export interface MeterLevel {
  readonly level: number;
  readonly peak: number;
  readonly clip: boolean;
}

/** Position of `db` on the scale: 0 at the floor (or below), 1 at 0 dBFS (or above). */
export function meterFraction(db: number, floorDb: number): number {
  if (!Number.isFinite(db)) return db > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, (db - floorDb) / -floorDb));
}

export interface MeterBarOptions {
  /** Whole bar including the clip cap. */
  readonly box: Box;
  /** No reading: an empty bar (no signal yet). */
  readonly reading?: MeterLevel | undefined;
  /** Key background, which the unlit part and dimming mix towards. */
  readonly background: string;
  /** Mix lit colours this far towards the background (a muted channel's meter). */
  readonly dim?: number | undefined;
  /** Draw only a grey track (offline). */
  readonly off?: boolean | undefined;
  /** Clip cap height (default 5) and the gap below it (default 2). */
  readonly capHeight?: number | undefined;
  readonly capGap?: number | undefined;
}

export function meterBar(theme: Theme, o: MeterBarOptions): string {
  const m = theme.meter;
  const capH = o.capHeight ?? 5;
  const capGap = o.capGap ?? 2;
  const { x, w } = o.box;
  const top = o.box.y + capH + capGap;
  const bottom = o.box.y + o.box.h;
  const h = bottom - top;
  const yOf = (db: number) => bottom - meterFraction(db, m.floorDb) * h;
  const dim = o.dim ?? 0;
  const lit = (c: string) => (dim > 0 ? mix(c, o.background, dim) : c);

  if (o.off === true) {
    const track = theme.offline.hatch;
    return (
      rect({ x, y: o.box.y, w, h: capH }, { fill: track }) +
      rect({ x, y: top, w, h }, { fill: track })
    );
  }

  const zones: readonly (readonly [number, number, string])[] = [
    [m.floorDb, m.yellow, m.green],
    [m.yellow, m.orange, m.yellowColor],
    [m.orange, m.red, m.orangeColor],
    [m.red, 0, m.redColor],
  ];
  const level = o.reading?.level ?? -Infinity;
  const levelY = yOf(level);
  let out = '';
  for (const [from, to, color] of zones) {
    const y0 = yOf(to);
    const y1 = yOf(from);
    if (y1 - y0 <= 0) continue;
    // Unlit part of the zone, then the lit part below the level line.
    const litTop = Math.min(y1, Math.max(y0, levelY));
    if (litTop > y0)
      out += rect({ x, y: y0, w, h: litTop - y0 }, { fill: mix(color, o.background, m.unlit) });
    if (y1 > litTop) out += rect({ x, y: litTop, w, h: y1 - litTop }, { fill: lit(color) });
  }

  const peak = o.reading?.peak;
  if (peak !== undefined && peak > m.floorDb && peak > level + 0.5) {
    const py = Math.max(top, Math.min(bottom - 2, yOf(peak) - 1));
    out += rect({ x, y: py, w, h: 2 }, { fill: lit(m.peak) });
  }

  const clip = o.reading?.clip === true;
  out += rect(
    { x, y: o.box.y, w, h: capH },
    { fill: clip ? lit(m.clip) : mix(m.clipOff, o.background, dim) },
  );
  return out;
}

export interface StereoMeterOptions extends Omit<MeterBarOptions, 'box' | 'reading'> {
  readonly box: Box;
  readonly left?: MeterLevel | undefined;
  readonly right?: MeterLevel | undefined;
  /** Two bars (left, right) or one (left). */
  readonly stereo: boolean;
  /** Bar width of one side of a stereo pair and of a mono bar. */
  readonly barWidth: number;
  readonly monoWidth: number;
  readonly gap: number;
}

/** One bar (mono) or two (stereo), right-aligned in `box`. */
export function meterPair(theme: Theme, o: StereoMeterOptions): string {
  const right = o.box.x + o.box.w;
  const { y, h } = o.box;
  const bar = (x: number, w: number, reading: MeterLevel | undefined) =>
    meterBar(theme, { ...o, box: { x, y, w, h }, reading });
  if (!o.stereo) return bar(right - o.monoWidth, o.monoWidth, o.left);
  const w = o.barWidth;
  return bar(right - 2 * w - o.gap, w, o.left) + bar(right - w, w, o.right);
}

/** Width a meter pair takes: two bars and the gap, or one mono bar. */
export function meterPairWidth(
  stereo: boolean,
  barWidth: number,
  monoWidth: number,
  gap: number,
): number {
  return stereo ? 2 * barWidth + gap : monoWidth;
}
