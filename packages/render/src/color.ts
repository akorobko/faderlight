// Colour arithmetic. Keys use solid colours only (no opacity, see svg.ts), so dimmed and
// tinted colours are mixed here.

export type Hex = `#${string}`;

function channels(c: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (!m?.[1]) throw new Error(`Not a #rgb or #rrggbb colour: ${c}`);
  const h = m[1].length === 3 ? m[1].replace(/./g, (d) => d + d) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

const hex2 = (v: number) =>
  Math.round(Math.max(0, Math.min(255, v)))
    .toString(16)
    .padStart(2, '0');

export function isHex(c: string): c is Hex {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
}

/** `a` mixed with `b`: t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): Hex {
  const ca = channels(a);
  const cb = channels(b);
  return `#${ca.map((v, i) => hex2(v + ((cb[i] ?? 0) - v) * t)).join('')}`;
}

/** Relative luminance (WCAG 2), 0 for black to 1 for white. */
export function luminance(c: string): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels(c).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
