// SVG building blocks. Keys use a small, conservative subset of SVG so that any renderer draws
// them the same way: <svg>, <g>, <path>, <rect>, <circle> and <line> with solid fills and
// strokes. No <text> (text is drawn as outlines, see text.ts), no CSS, no opacity, clip
// paths, masks, patterns, gradients, filters or transforms. Colours are mixed in code instead
// of with opacity. test/svg-subset.test.ts holds every key to this list.

/** Rounds to 0.1 px and drops trailing zeros: 12 -> "12", 12.25 -> "12.3", -0 -> "0". */
export function num(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

export type Attrs = Readonly<Record<string, string | number | undefined>>;

function attrs(a: Attrs): string {
  let out = '';
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined) continue;
    out += ` ${k}="${typeof v === 'number' ? num(v) : escapeXml(v)}"`;
  }
  return out;
}

export function el(name: string, a: Attrs, children?: string): string {
  return children === undefined || children === ''
    ? `<${name}${attrs(a)}/>`
    : `<${name}${attrs(a)}>${children}</${name}>`;
}

/**
 * A whole key: `content` is drawn on a `canvas` x `canvas` canvas, with `bleed` more on every
 * side for backgrounds and frames, and the whole of it scaled to `size` pixels.
 */
export function document(content: string, size: number, canvas = 144, bleed = 0): string {
  const box = `${num(-bleed)} ${num(-bleed)} ${num(canvas + 2 * bleed)} ${num(canvas + 2 * bleed)}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(size)}" height="${num(size)}" ` +
    `viewBox="${box}">${content}</svg>`
  );
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Paint {
  readonly fill?: string | undefined;
  readonly stroke?: string | undefined;
  readonly strokeWidth?: number | undefined;
  readonly dash?: readonly number[] | undefined;
}

function paint(p: Paint): Attrs {
  return {
    fill: p.fill ?? 'none',
    stroke: p.stroke,
    'stroke-width': p.stroke === undefined ? undefined : (p.strokeWidth ?? 1),
    'stroke-dasharray': p.dash?.map(num).join(' '),
  };
}

export function rect(box: Box, p: Paint, radius = 0): string {
  return el('rect', {
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    rx: radius > 0 ? radius : undefined,
    ...paint(p),
  });
}

export function circle(cx: number, cy: number, r: number, p: Paint): string {
  return el('circle', { cx, cy, r, ...paint(p) });
}

export function line(x1: number, y1: number, x2: number, y2: number, p: Paint): string {
  return el('line', { x1, y1, x2, y2, 'stroke-linecap': 'round', ...paint(p) });
}

export function path(d: string, p: Paint): string {
  return d === '' ? '' : el('path', { d, ...paint(p) });
}

/** A closed polygon as path data. */
export function polygon(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${num(x)} ${num(y)}`).join('') + 'Z';
}

// Cubic approximation of a quarter circle (control points at this fraction of the radius).
const KAPPA = 0.5523;

/**
 * Path data for a rectangle with separately rounded corners (tl, tr, br, bl). Corners are
 * cubic curves, not arcs: SVG Tiny, which some key renderers implement, has no arcs.
 */
export function roundedRect(box: Box, radii: readonly [number, number, number, number]): string {
  const { x, y, w, h } = box;
  const max = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, max))) as [
    number,
    number,
    number,
    number,
  ];
  // From the current point (on one edge) around corner (cx, cy) to (ex, ey) on the next edge.
  const corner = (
    r: number,
    sx: number,
    sy: number,
    cx: number,
    cy: number,
    ex: number,
    ey: number,
  ) =>
    r > 0
      ? `L${num(sx)} ${num(sy)}C${num(sx + (cx - sx) * KAPPA)} ${num(sy + (cy - sy) * KAPPA)} ` +
        `${num(ex + (cx - ex) * KAPPA)} ${num(ey + (cy - ey) * KAPPA)} ${num(ex)} ${num(ey)}`
      : `L${num(cx)} ${num(cy)}`;
  return (
    `M${num(x + tl)} ${num(y)}` +
    corner(tr, x + w - tr, y, x + w, y, x + w, y + tr) +
    corner(br, x + w, y + h - br, x + w, y + h, x + w - br, y + h) +
    corner(bl, x + bl, y + h, x, y + h, x, y + h - bl) +
    corner(tl, x, y + tl, x, y, x + tl, y) +
    'Z'
  );
}

/** Path data for a rectangle with all corners rounded by `r`. */
export function roundRect(box: Box, r: number): string {
  return roundedRect(box, [r, r, r, r]);
}
