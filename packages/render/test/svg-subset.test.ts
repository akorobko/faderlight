// Holds every key to the SVG subset in src/svg.ts: elements, attributes and path commands that
// every renderer (the Stream Deck app, browsers, resvg) draws the same way.

import { describe, expect, it } from 'vitest';
import { DARK, KEY, PAD, renderKey, svgDataUrl, type KeyView } from '../src/index.ts';
import { CASES } from './cases.ts';
import { CONSOLE_PAGES } from './pages.ts';

const ELEMENTS = new Set(['svg', 'path', 'rect', 'circle', 'line']);
const ATTRIBUTES = new Set([
  'xmlns',
  'width',
  'height',
  'viewBox',
  'x',
  'y',
  'rx',
  'cx',
  'cy',
  'r',
  'x1',
  'y1',
  'x2',
  'y2',
  'd',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
]);

interface Tag {
  readonly name: string;
  readonly attrs: readonly (readonly [string, string])[];
  readonly closing: boolean;
  readonly selfClosing: boolean;
}

function tags(svg: string): Tag[] {
  return [...svg.matchAll(/<(\/?)([a-zA-Z]+)((?:\s+[^\s=>]+="[^"]*")*)\s*(\/?)>/g)].map((m) => ({
    name: m[2] ?? '',
    closing: m[1] === '/',
    selfClosing: m[4] === '/',
    attrs: [...(m[3] ?? '').matchAll(/([^\s=]+)="([^"]*)"/g)].map(
      (a) => [a[1] ?? '', a[2] ?? ''] as const,
    ),
  }));
}

const views: { name: string; view: KeyView }[] = [
  ...CASES.map((c) => ({ name: c.name, view: c.view })),
  ...CONSOLE_PAGES.flatMap((p, pi) =>
    p.keys.flatMap((view, i) =>
      view === undefined ? [] : [{ name: `page${String(pi)}-${String(i)}`, view }],
    ),
  ),
];

describe('SVG subset', () => {
  it.each(views)('$name', ({ view }) => {
    const svg = renderKey(view, DARK, 96);
    const all = tags(svg);
    // Everything in the string is a tag: no text nodes, comments or CDATA.
    expect(svg.replace(/<[^>]*>/g, '')).toBe('');
    expect(all.map((t) => t.name).filter((n) => !ELEMENTS.has(n))).toEqual([]);
    // Balanced: one <svg> open and close, everything else self-closing.
    expect(all.filter((t) => !t.selfClosing && t.name !== 'svg')).toEqual([]);
    expect(all[0]).toMatchObject({ name: 'svg', closing: false });
    expect(all.at(-1)).toMatchObject({ name: 'svg', closing: true });

    for (const t of all) {
      for (const [name, value] of t.attrs) {
        expect(ATTRIBUTES.has(name), `attribute ${name}`).toBe(true);
        expect(value, `${t.name} ${name}`).not.toMatch(/NaN|Infinity|undefined/);
        if (name === 'fill' || name === 'stroke') expect(value).toMatch(/^(#[0-9a-f]{6}|none)$/);
        if (name === 'd') expect(value).toMatch(/^M[-\d. MLQCZ]*$/);
      }
    }
  });

  const channel: KeyView = { kind: 'channel', label: 'MIC 9', name: 'Vocal' };

  it('scales to the requested size: the 144 canvas plus its margin on every side', () => {
    expect(renderKey(channel, DARK, 72)).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="72" height="72" viewBox="-14 -14 172 172">/,
    );
  });

  it('keeps text and icons inside the 144 canvas, off the keycap edge', () => {
    // Only the background, the pad, hatching, the pending frame (stroked) and the meter bars
    // (rects, 1 px) reach into the margin; every filled path, which is all text and the solid
    // icons, stays on the canvas.
    for (const { name, view } of views) {
      const svg = renderKey(view);
      for (const m of svg.matchAll(/<path d="([^"]*)" fill="(?!none)/g)) {
        const nums = (m[1] ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
        for (const n of nums) {
          expect(n, `${name}: path coordinate ${String(n)}`).toBeGreaterThanOrEqual(0);
          expect(n, `${name}: path coordinate ${String(n)}`).toBeLessThanOrEqual(144);
        }
      }
    }
  });

  it('keeps colour off the key edge: only the plain background reaches it', () => {
    // A band or a frame at the edge bends under the keycap. Every rect but the background
    // (the pad, meter bars, chips) stays inside the pad.
    const rect = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
    for (const { name, view } of views) {
      for (const m of renderKey(view).matchAll(rect)) {
        const [x = 0, y = 0, w = 0, h = 0] = m.slice(1, 5).map(Number);
        if (x === KEY.x && y === KEY.y && w === KEY.w && h === KEY.h) continue;
        const at = `${name}: rect at ${String(x)}, ${String(y)}`;
        expect(Math.min(x, y), at).toBeGreaterThanOrEqual(PAD.x);
        expect(Math.max(x + w, y + h), at).toBeLessThanOrEqual(PAD.x + PAD.w);
      }
    }
  });

  it('is pure: the same view renders the same string', () => {
    for (const { view } of views.slice(0, 20)) {
      expect(renderKey(view)).toBe(renderKey(structuredClone(view)));
    }
  });

  it('makes data URLs for setImage', () => {
    const svg = renderKey(channel);
    const url = svgDataUrl(svg);
    expect(url.startsWith('data:image/svg+xml;charset=utf8,')).toBe(true);
    expect(decodeURIComponent(url.slice(url.indexOf(',') + 1))).toBe(svg);
  });
});
