import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dbAtPosition, FADER_MAX_DB, FADER_MIN_DB, positionAtDb, stepDb } from '../src/index.ts';

describe('fader law', () => {
  it('spans off, -65 dB just above the bottom, and +6 dB at the top', () => {
    expect(dbAtPosition(0)).toBe(-Infinity);
    expect(dbAtPosition(-1)).toBe(-Infinity);
    expect(dbAtPosition(1e-9)).toBeCloseTo(FADER_MIN_DB, 3);
    expect(dbAtPosition(1)).toBeCloseTo(FADER_MAX_DB, 6);
    expect(dbAtPosition(2)).toBeCloseTo(FADER_MAX_DB, 6);
  });

  it('is continuous at the -6 dB knee', () => {
    const knee = 649 / 1023;
    expect(dbAtPosition(knee)).toBeCloseTo(-6, 6);
    expect(dbAtPosition(knee - 1e-9)).toBeCloseTo(-6, 4);
    expect(positionAtDb(-6)).toBeCloseTo(knee, 9);
    expect(positionAtDb(-6.000001)).toBeCloseTo(knee, 6);
  });

  it('puts 0 dB where TotalMix does (about 82 % of the travel)', () => {
    expect(positionAtDb(0)).toBeCloseTo(836 / 1023, 3);
  });

  it('maps off and anything at or below -65 dB to the bottom, +6 dB and above to the top', () => {
    expect(positionAtDb(-Infinity)).toBe(0);
    expect(positionAtDb(-300)).toBe(0);
    expect(positionAtDb(-65)).toBe(0);
    expect(positionAtDb(6)).toBe(1);
    expect(positionAtDb(20)).toBe(1);
  });

  it('round-trips any position (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 1e-6, max: 1, noNaN: true }), (p) => {
        expect(positionAtDb(dbAtPosition(p))).toBeCloseTo(p, 9);
      }),
    );
  });

  it('increases with the position (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e-6, max: 1, noNaN: true }),
        fc.double({ min: 1e-6, max: 1, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          if (hi - lo < 1e-9) return; // closer than double precision can tell apart in dB
          expect(dbAtPosition(lo)).toBeLessThan(dbAtPosition(hi));
        },
      ),
    );
  });

  it('rejects NaN', () => {
    expect(() => dbAtPosition(NaN)).toThrow(RangeError);
    expect(() => positionAtDb(NaN)).toThrow(RangeError);
  });
});

describe('stepDb', () => {
  it('moves by whole fader steps and rounds to 0.01 dB', () => {
    expect(stepDb(0, 1)).toBeCloseTo(0.03, 2);
    expect(stepDb(0, -1)).toBeCloseTo(-0.03, 2);
    expect(stepDb(-20, 10)).toBeGreaterThan(-20);
    expect(stepDb(-20, -10)).toBeLessThan(-20);
  });

  it('stops at the top and goes to off below the bottom', () => {
    expect(stepDb(6, 5)).toBe(6);
    expect(stepDb(-64.9, -10)).toBe(-Infinity);
    expect(stepDb(-Infinity, -1)).toBe(-Infinity);
  });

  it('leaves off at the lowest audible position on the first step up', () => {
    const first = stepDb(-Infinity, 1);
    expect(first).toBeGreaterThan(FADER_MIN_DB);
    expect(first).toBeLessThan(-64);
  });
});
