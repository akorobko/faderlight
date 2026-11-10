import { describe, expect, it } from 'vitest';
import { MeterBank } from '../src/index.ts';

describe('MeterBank', () => {
  it('reads the floor for a channel without data', () => {
    const m = new MeterBank();
    expect(m.read('input', 8, 0)).toEqual({ level: -100, peak: -100, clip: false });
    expect(m.has('input', 8)).toBe(false);
  });

  it('keeps the latest level until a new one arrives (TotalMix sends only changes)', () => {
    const m = new MeterBank();
    m.push('input', 8, -20, 0);
    expect(m.read('input', 8, 10_000).level).toBeCloseTo(-20);
    m.push('input', 8, -30, 10_000);
    expect(m.read('input', 8, 10_000).level).toBeCloseTo(-30);
    expect(m.has('input', 8)).toBe(true);
    expect(m.read('input', 9, 10_000).level).toBe(-100);
  });

  it('holds the peak for the peak hold window', () => {
    const m = new MeterBank({ peakHoldMs: 1500 });
    m.push('output', 2, -6, 0);
    for (let t = 40; t <= 1000; t += 40) m.push('output', 2, -6 - t / 40, t);
    expect(m.read('output', 2, 1000).peak).toBeCloseTo(-6);
    expect(m.read('output', 2, 1500).peak).toBeCloseTo(-6);
    // The -6 dB sample at t=0 has left the window; the next highest is -7 dB at t=40.
    expect(m.read('output', 2, 1501).peak).toBeCloseTo(-7);
    // Long after: the peak is the latest level.
    expect(m.read('output', 2, 60_000).peak).toBeCloseTo(m.read('output', 2, 60_000).level);
  });

  it('lights clip for an over (+6 dB) and keeps it for the clip hold time', () => {
    const m = new MeterBank({ clipHoldMs: 3000 });
    m.push('input', 8, -10, 0);
    expect(m.read('input', 8, 0).clip).toBe(false);
    m.push('input', 8, Math.fround(6), 100);
    // TotalMix's over decay: 5.2, 4.4, ... then normal levels again.
    m.push('input', 8, Math.fround(5.2), 2100);
    m.push('input', 8, -12, 2500);
    expect(m.read('input', 8, 2500).clip).toBe(true);
    expect(m.read('input', 8, 3100).clip).toBe(true);
    expect(m.read('input', 8, 3101).clip).toBe(false);
  });

  it('does not count the over decay (values below +6) as a new clip', () => {
    const m = new MeterBank();
    m.push('input', 8, Math.fround(5.2), 0);
    m.push('input', 8, Math.fround(4.4), 40);
    expect(m.read('input', 8, 40).clip).toBe(false);
  });

  it('overwrites the oldest levels when the ring is full', () => {
    const m = new MeterBank({ capacity: 4, peakHoldMs: 10_000 });
    m.push('input', 0, 0, 0); // will be overwritten
    for (let i = 1; i <= 4; i++) m.push('input', 0, -10 * i, i);
    const r = m.read('input', 0, 5);
    expect(r.level).toBeCloseTo(-40);
    expect(r.peak).toBeCloseTo(-10);
  });

  it('forgets everything on reset', () => {
    const m = new MeterBank();
    m.push('input', 8, 6, 0);
    m.reset();
    expect(m.read('input', 8, 0)).toEqual({ level: -100, peak: -100, clip: false });
  });
});
