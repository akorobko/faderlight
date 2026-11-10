import { describe, expect, it } from 'vitest';
import {
  contrast,
  DARK,
  document,
  el,
  escapeXml,
  formatGain,
  formatLevel,
  formatPeak,
  formatRate,
  formatTime,
  HIGH_CONTRAST,
  isHex,
  meterBar,
  meterFraction,
  mix,
  num,
  roundedRect,
  THEMES,
} from '../src/index.ts';

describe('svg', () => {
  it('rounds numbers to 0.1 px', () => {
    expect(num(12)).toBe('12');
    expect(num(12.26)).toBe('12.3');
    expect(num(-0.04)).toBe('0');
    expect(num(-3.25)).toBe('-3.2');
  });

  it('escapes attribute values and leaves out undefined ones', () => {
    expect(escapeXml(`a<b>&"'`)).toBe('a&#60;b&#62;&#38;&#34;&#39;');
    expect(el('rect', { x: 1, y: undefined, fill: '#fff' })).toBe('<rect x="1" fill="#fff"/>');
    expect(el('g', {}, '<path/>')).toBe('<g><path/></g>');
  });

  it('wraps a key in an SVG scaled to its size', () => {
    const svg = document('<path/>', 96);
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 144 144"><path/></svg>',
    );
  });

  it('rounds corners with cubic curves, not arcs', () => {
    const d = roundedRect({ x: 0, y: 0, w: 40, h: 20 }, [4, 4, 0, 30]);
    expect(d).not.toMatch(/A/);
    expect(d.match(/C/g)).toHaveLength(3);
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('color', () => {
  it('mixes colours', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000', '#fff', 0.5)).toBe('#808080');
    expect(() => mix('red', '#fff', 0.5)).toThrow();
  });

  it('measures WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 6);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 6);
    expect(isHex('#a1b2c3')).toBe(true);
    expect(isHex('#a1b2c')).toBe(false);
  });
});

describe('format', () => {
  it('formats levels with a true minus and −∞ for off', () => {
    expect(formatLevel(-18.5)).toBe('−18.5');
    expect(formatLevel(0)).toBe('0.0');
    expect(formatLevel(-0.04)).toBe('0.0');
    expect(formatLevel(6)).toBe('+6.0');
    expect(formatLevel(-Infinity)).toBe('−∞');
    expect(formatLevel(-300)).toBe('−∞');
    expect(formatLevel(undefined)).toBe('––');
  });

  it('formats gain in whole or half dB', () => {
    expect(formatGain(42)).toBe('+42');
    expect(formatGain(6.5)).toBe('+6.5');
    expect(formatGain(0)).toBe('0');
    expect(formatGain(8.04)).toBe('+8');
    expect(formatGain(undefined)).toBe('––');
  });

  it('formats peaks, times and sample rates', () => {
    expect(formatPeak(-1.24, -60)).toBe('−1.2');
    expect(formatPeak(-80, -60)).toBe('−∞');
    expect(formatPeak(6, -60)).toBe('OVER');
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(754)).toBe('12:34');
    expect(formatTime(3723)).toBe('1:02:03');
    expect(formatRate(48000)).toBe('48 kHz');
    expect(formatRate(44100)).toBe('44.1 kHz');
    expect(formatRate(undefined)).toBe('–– kHz');
  });
});

describe('meter', () => {
  it('maps dBFS onto the scale', () => {
    expect(meterFraction(-60, -60)).toBe(0);
    expect(meterFraction(-30, -60)).toBe(0.5);
    expect(meterFraction(0, -60)).toBe(1);
    expect(meterFraction(6, -60)).toBe(1);
    expect(meterFraction(-100, -60)).toBe(0);
    expect(meterFraction(-Infinity, -60)).toBe(0);
  });

  const box = { x: 0, y: 0, w: 10, h: 107 };
  const bg = DARK.normal.background;
  const rects = (svg: string) => [...svg.matchAll(/<rect ([^>]*)\/>/g)].map((m) => m[1] ?? '');

  it('lights the bar up to the level and marks the peak', () => {
    const svg = meterBar(DARK, {
      box,
      background: bg,
      reading: { level: -30, peak: -10, clip: false },
    });
    // Bar area is 100 px tall below a 5 px cap and a 2 px gap: −30 dBFS lights the lower half.
    expect(svg).toContain(`y="57" width="10" height="50" fill="${DARK.meter.green}"`);
    // Above it each zone is unlit in its own colour, nothing overlaps.
    expect(svg).toContain(
      `y="37" width="10" height="20" fill="${mix(DARK.meter.green, bg, DARK.meter.unlit)}"`,
    );
    expect(svg).toContain(
      `y="17" width="10" height="20" fill="${mix(DARK.meter.yellowColor, bg, DARK.meter.unlit)}"`,
    );
    // Peak tick at −10 dBFS, 83.3 % up the bar: 2 px centred on the level line.
    expect(svg).toContain('y="22.7" width="10" height="2" fill="#ffffff"');
    expect(rects(svg).at(-1)).toContain(`fill="${mix(DARK.meter.clipOff, bg, 0)}"`);
  });

  it('lights the clip cap on an over', () => {
    const svg = meterBar(DARK, {
      box,
      background: bg,
      reading: { level: -1, peak: 0, clip: true },
    });
    expect(rects(svg).at(-1)).toContain(`fill="${DARK.meter.clip}"`);
  });

  it('has no peak tick when the peak is the level, and only a grey track offline', () => {
    const quiet = meterBar(DARK, {
      box,
      background: bg,
      reading: { level: -20, peak: -20, clip: false },
    });
    expect(quiet).not.toContain('height="2"');
    const off = meterBar(DARK, {
      box,
      background: bg,
      off: true,
      reading: { level: -1, peak: 0, clip: true },
    });
    expect(rects(off)).toHaveLength(2);
    expect(off).not.toContain(DARK.meter.clip);
  });
});

describe('themes', () => {
  it.each(Object.values(THEMES))('$name keeps text readable', (theme) => {
    for (const s of [theme.normal, theme.muted, theme.soloed, theme.lit]) {
      expect(contrast(s.text, s.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.subtext, s.background)).toBeGreaterThanOrEqual(4.5);
    }
    // Offline is greyed out on purpose, but "OFFLINE" must still be legible.
    expect(contrast(theme.offline.subtext, theme.offline.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(theme.accent.muteInk, theme.accent.mute)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.accent.soloInk, theme.accent.solo)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.accent.phantomInk, theme.accent.phantom)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.accent.dimInk, theme.accent.dim)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.values(THEMES))('$name keeps to three text sizes, legible at 96 px', (theme) => {
    // Smallest text at least 10 px on the XL; values at least 26 px on the 144 canvas.
    expect((theme.type.small * 96) / 144).toBeGreaterThanOrEqual(10);
    expect(theme.type.large).toBeGreaterThanOrEqual(26);
    expect(theme.type.small).toBeLessThan(theme.type.medium);
    expect(theme.type.medium).toBeLessThan(theme.type.large);
  });

  it('high contrast is at least as strong as dark', () => {
    expect(contrast(HIGH_CONTRAST.normal.text, HIGH_CONTRAST.normal.background)).toBeGreaterThan(
      contrast(DARK.normal.text, DARK.normal.background),
    );
    expect(HIGH_CONTRAST.frame.pending).toBeGreaterThan(DARK.frame.pending);
  });
});
