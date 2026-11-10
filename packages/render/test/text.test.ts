import { describe, expect, it } from 'vitest';
import { ELLIPSIS, fitText, measure, textPathData, wrapLines } from '../src/index.ts';

const style = { face: 'semibold', size: 22 } as const;

/** x coordinates of the points in path data (pairs after M, L and Q). */
function xs(d: string): number[] {
  const nums = [...d.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
  return nums.filter((_, i) => i % 2 === 0);
}

describe('measure', () => {
  it('is 0 for empty text and grows with size', () => {
    expect(measure('', style)).toBe(0);
    const w = measure('Vocal', style);
    expect(w).toBeGreaterThan(30);
    expect(measure('Vocal', { ...style, size: 44 })).toBeCloseTo(2 * w, 6);
  });

  it('applies kerning', () => {
    expect(measure('AV', style)).toBeLessThan(measure('A', style) + measure('V', style));
  });

  it('adds tracking between characters, not after the last', () => {
    const plain = measure('MIC', style);
    expect(measure('MIC', { ...style, tracking: 1 })).toBeCloseTo(plain + 2, 6);
  });

  it('makes digits equally wide with tabular figures', () => {
    const t = { ...style, tabular: true };
    expect(measure('1111', t)).toBeCloseTo(measure('8888', t), 6);
    expect(measure('1111', style)).toBeLessThan(measure('8888', style));
  });
});

describe('fitText', () => {
  const sizes = [22, 15];

  it('keeps the largest size when the text fits', () => {
    const f = fitText('Vocal', { face: 'semibold', sizes, maxWidth: 90 });
    expect(f).toMatchObject({ text: 'Vocal', size: 22, scaleX: 1, truncated: false });
  });

  it('narrows the text before dropping a size', () => {
    const w = measure('Guitar DI', style);
    const f = fitText('Guitar DI', { face: 'semibold', sizes, maxWidth: w * 0.9 });
    expect(f.size).toBe(22);
    expect(f.scaleX).toBeCloseTo(0.9, 6);
    expect(f.width).toBeCloseTo(w * 0.9, 6);
  });

  it('drops to a smaller size when narrowing is not enough', () => {
    const w15 = measure('Background', { ...style, size: 15 });
    const f = fitText('Background', { face: 'semibold', sizes, maxWidth: w15 });
    expect(f.size).toBe(15);
    expect(f.truncated).toBe(false);
  });

  it('cuts with an ellipsis at the smallest size, within the width', () => {
    const f = fitText('Background Vocals Left', { face: 'semibold', sizes, maxWidth: 60 });
    expect(f.truncated).toBe(true);
    expect(f.size).toBe(15);
    expect(f.text.endsWith(ELLIPSIS)).toBe(true);
    expect(f.text.startsWith('Back')).toBe(true);
    expect(f.width).toBeLessThanOrEqual(60 + 1e-9);
  });

  it('never cuts inside a character and its combining accent', () => {
    const s = 'Café Café Café';
    for (let maxWidth = 10; maxWidth < 90; maxWidth += 3) {
      const f = fitText(s, { face: 'semibold', sizes: [15], maxWidth });
      const kept = f.text.replace(ELLIPSIS, '');
      expect(s.startsWith(kept)).toBe(true);
      expect(kept.endsWith('e')).toBe(false);
    }
  });
});

describe('textPathData', () => {
  it('anchors text at its start, middle or end', () => {
    const at = (anchor: 'start' | 'middle' | 'end') => {
      const x = xs(textPathData('HI', { ...style, x: 72, y: 50, anchor }));
      return [Math.min(...x), Math.max(...x)] as const;
    };
    const [startMin] = at('start');
    const [, endMax] = at('end');
    const [midMin, midMax] = at('middle');
    expect(startMin).toBeGreaterThanOrEqual(72);
    expect(endMax).toBeLessThanOrEqual(72);
    expect((midMin + midMax) / 2).toBeCloseTo(72, 0);
  });

  it('narrows horizontally with scaleX', () => {
    const span = (scaleX: number) => {
      const x = xs(textPathData('MMMM', { ...style, x: 0, y: 50, scaleX }));
      return Math.max(...x) - Math.min(...x);
    };
    expect(span(0.5)).toBeCloseTo(span(1) / 2, 0);
  });

  it('is empty for empty text and repeatable', () => {
    expect(textPathData('', { ...style, x: 0, y: 0 })).toBe('');
    const a = textPathData('Vocal', { ...style, x: 10, y: 40 });
    expect(textPathData('Vocal', { ...style, x: 10, y: 40 })).toBe(a);
    expect(a).not.toMatch(/NaN|Infinity/);
  });
});

describe('wrapLines', () => {
  const o = { face: 'semibold', sizes: [15], maxWidth: 80, maxLines: 2 } as const;

  it('breaks at spaces', () => {
    const lines = wrapLines('No reply on port 9002', o);
    expect(lines.length).toBe(2);
    expect(lines.join(' ')).toBe('No reply on port 9002');
  });

  it('puts the rest into the last line', () => {
    const lines = wrapLines('one two three four five six seven eight nine ten', o);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith('ten')).toBe(true);
  });

  it('keeps short text on one line', () => {
    expect(wrapLines('  Port in use ', o)).toEqual(['Port in use']);
    expect(wrapLines('', o)).toEqual([]);
  });
});
