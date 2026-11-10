import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  contoursToSegments,
  face,
  FontError,
  fonts,
  parseFont,
  useFonts,
  type Segment,
} from '../src/index.ts';

const semibold = face('semibold');
const bold = face('bold');
const g = (ch: string) => semibold.glyphIndex(ch.codePointAt(0) ?? 0);
const moves = (segments: readonly Segment[]) => segments.filter((s) => s.op === 'M').length;

describe('bundled fonts', () => {
  it('are Fira Sans Condensed SemiBold and Bold', () => {
    expect(semibold.name).toBe('Fira Sans Condensed SemiBold');
    expect(bold.name).toBe('Fira Sans Condensed Bold');
    expect(semibold.unitsPerEm).toBe(1000);
    expect(semibold.capHeight).toBeGreaterThan(600);
    expect(semibold.capHeight).toBeLessThan(semibold.ascender);
  });

  it('map Latin, Greek, Cyrillic and the symbols keys use', () => {
    for (const ch of ['A', 'z', 'é', 'Ø', 'Ж', 'я', 'Ω', '∞', '−', '–', '…', '→']) {
      expect(g(ch), ch).toBeGreaterThan(0);
    }
  });

  it('give 0 (.notdef) for characters they do not have', () => {
    expect(g('▲')).toBe(0);
    expect(g('😀')).toBe(0);
  });

  it('read advance widths', () => {
    expect(semibold.advance(g('M'))).toBeGreaterThan(semibold.advance(g('i')));
    expect(semibold.advance(g(' '))).toBeGreaterThan(0);
    expect(semibold.advance(-1)).toBe(0);
  });

  it('read pair kerning from GPOS (inside extension lookups)', () => {
    expect(semibold.kerning(g('A'), g('V'))).toBeLessThan(0);
    expect(semibold.kerning(g('T'), g('o'))).toBeLessThan(0);
    expect(semibold.kerning(g('H'), g('H'))).toBe(0);
  });

  it('read simple and composite outlines', () => {
    const o = semibold.outline(g('o'));
    expect(moves(o)).toBe(2);
    expect(o.at(-1)).toEqual({ op: 'Z' });
    // é is a composite of e and an accent.
    expect(moves(semibold.outline(g('é')))).toBeGreaterThanOrEqual(2);
    expect(semibold.outline(g(' '))).toEqual([]);
  });

  it('rejects files that are not TrueType', () => {
    expect(() => parseFont(new TextEncoder().encode('wOFF0000000000000000'))).toThrow(FontError);
  });
});

describe('contoursToSegments', () => {
  it('draws on-curve points as lines', () => {
    const square = [
      { x: 0, y: 0, on: true },
      { x: 10, y: 0, on: true },
      { x: 10, y: 10, on: true },
    ];
    expect(contoursToSegments([square])).toEqual([
      { op: 'M', x: 0, y: 0 },
      { op: 'L', x: 10, y: 0 },
      { op: 'L', x: 10, y: 10 },
      { op: 'Z' },
    ]);
  });

  it('inserts the implied on-curve point between two off-curve points', () => {
    const segs = contoursToSegments([
      [
        { x: 0, y: 0, on: true },
        { x: 10, y: 0, on: false },
        { x: 10, y: 10, on: false },
      ],
    ]);
    expect(segs).toEqual([
      { op: 'M', x: 0, y: 0 },
      { op: 'Q', cx: 10, cy: 0, x: 10, y: 5 },
      { op: 'Q', cx: 10, cy: 10, x: 0, y: 0 },
      { op: 'Z' },
    ]);
  });

  it('starts an all off-curve contour at the midpoint of its first and last point', () => {
    const segs = contoursToSegments([
      [
        { x: 0, y: 10, on: false },
        { x: 10, y: 0, on: false },
      ],
    ]);
    expect(segs[0]).toEqual({ op: 'M', x: 5, y: 5 });
    expect(segs.filter((s) => s.op === 'Q')).toHaveLength(2);
  });
});

describe('useFonts', () => {
  it('replaces the bundled faces with the given files', () => {
    const file = (name: string) => readFileSync(new URL(`../fonts/${name}`, import.meta.url));
    const before = fonts();
    useFonts({
      semibold: file('FiraSansCondensed-SemiBold.ttf'),
      bold: file('FiraSansCondensed-Bold.ttf'),
    });
    expect(fonts()).not.toBe(before);
    expect(fonts().bold.name).toBe('Fira Sans Condensed Bold');
  });
});
