import { formatMessage } from '@faderlight/osc';
import { describe, expect, it } from 'vitest';
import {
  METER_FALL_DB,
  METER_FLOOR_DB,
  METER_OVER_FALL_DB,
  MeterBallistics,
  MeterEngine,
  meterSignals,
  SimMixer,
  signalPeak,
  studioMixer,
} from '../src/index.ts';
import { seeded } from './helpers.ts';

const FRAME = 40;

describe('MeterBallistics', () => {
  it('follows a rising signal at once and falls 0.6 dB per frame', () => {
    const m = new MeterBallistics();
    expect(m.step(-20, 0)).toBe(-20);
    expect(m.step(-50, FRAME)).toBeCloseTo(-20 - METER_FALL_DB);
    expect(m.step(-50, 2 * FRAME)).toBeCloseTo(-20 - 2 * METER_FALL_DB);
    expect(m.step(-10, 3 * FRAME)).toBe(-10);
  });

  it('shows an over as +6, holds it for 2 s, then falls 0.8 dB per frame', () => {
    const m = new MeterBallistics();
    expect(m.step(0.5, 0)).toBe(6);
    expect(m.step(-60, 1960)).toBe(6);
    expect(m.step(-60, 2000)).toBeCloseTo(6 - METER_OVER_FALL_DB);
    expect(m.step(-60, 2040)).toBeCloseTo(6 - 2 * METER_OVER_FALL_DB);
    // Once it meets the signal it follows it, and falls at the normal rate again.
    let t = 2080;
    let level = 6;
    for (; level > -3; t += FRAME) level = m.step(-3, t);
    expect(level).toBe(-3);
    expect(m.step(-60, t)).toBeCloseTo(-3 - METER_FALL_DB);
  });

  it('stops at the floor', () => {
    const m = new MeterBallistics();
    m.step(-99.9, 0);
    m.step(-Infinity, FRAME);
    expect(m.step(-Infinity, 2 * FRAME)).toBe(METER_FLOOR_DB);
  });
});

describe('signalPeak', () => {
  const random = seeded(3);

  it('noise stays within its spread', () => {
    for (let t = 0; t < 4000; t += FRAME) {
      const db = signalPeak({ type: 'noise', db: -18, spreadDb: 3 }, t, random);
      expect(db).toBeGreaterThanOrEqual(-21);
      expect(db).toBeLessThanOrEqual(-15);
    }
  });

  it('drums hit on the beat, decay, and go over on every nth hit', () => {
    const drums = { type: 'drums', bpm: 120, peakDb: -6, clipEvery: 4 } as const;
    expect(signalPeak(drums, 0, random)).toBe(-6);
    expect(signalPeak(drums, 250, random)).toBe(-21); // 60 dB/s for 250 ms
    expect(signalPeak(drums, 1500, random)).toBe(1); // 4th hit
  });

  it('a sweep ramps and starts again', () => {
    const sweep = { type: 'sweep', fromDb: -60, toDb: 0, periodMs: 1000 } as const;
    expect(signalPeak(sweep, 0, random)).toBe(-60);
    expect(signalPeak(sweep, 500, random)).toBe(-30);
    expect(signalPeak(sweep, 1000, random)).toBe(-60);
  });
});

function mono(): SimMixer {
  const m = new SimMixer({ hidden: true });
  m.setVisible('input', 8, true);
  m.setVisible('input', 10, true);
  m.setStereo('input', 10, true);
  m.setVisible('input', 0, false);
  m.setVisible('output', 0, true);
  m.setStereo('output', 0, true);
  return m;
}

describe('MeterEngine', () => {
  it('sends only visible meters that changed, and nothing for silence', () => {
    const mixer = mono();
    const engine = new MeterEngine(mixer, { signals: { 'in/8': { type: 'tone', db: -20 } } });
    expect(engine.frame(0).map(formatMessage)).toEqual(['/level/in/8 f:-20']);
    expect(engine.frame(FRAME)).toEqual([]); // steady tone: no change
    engine.setSignal('in/8', undefined);
    expect(engine.frame(2 * FRAME).map(formatMessage)).toEqual([
      '/level/in/8 f:-20.600000381469727',
    ]);
  });

  it('the full frame covers every visible meter, silent ones at -100', () => {
    const engine = new MeterEngine(mono());
    expect(engine.fullFrame().map(formatMessage)).toEqual([
      '/level/in/8 f:-100',
      '/level/in/10 f:-100',
      '/level/in/11 f:-100',
      '/level/out/0 f:-100',
      '/level/out/1 f:-100',
    ]);
  });

  it('output meters follow the mix: route fader, source mute, output volume and mute', () => {
    const mixer = mono();
    const engine = new MeterEngine(mixer, { signals: { 'in/8': { type: 'tone', db: -20 } } });
    engine.frame(0);
    expect(engine.level('out', 0)).toBe(METER_FLOOR_DB); // route off
    mixer.setValue('/mix/in/8/0/fader', -6);
    mixer.setValue('/output/0/volume', -10);
    engine.frame(FRAME);
    expect(engine.level('out', 0)).toBeCloseTo(-36);
    expect(engine.level('out', 1)).toBeCloseTo(-36); // a mono source feeds both sides
    mixer.setValue('/input/8/mute', 1);
    engine.frame(2 * FRAME);
    expect(engine.level('out', 0)).toBeCloseTo(-36 - METER_FALL_DB);
    mixer.setValue('/input/8/mute', 0);
    mixer.setValue('/output/0/mute', 1);
    engine.frame(3 * FRAME);
    expect(engine.level('out', 0)).toBeCloseTo(-36 - 2 * METER_FALL_DB);
  });

  it('a stereo source feeds its sides to the matching output sides', () => {
    const mixer = mono();
    mixer.setValue('/mix/in/10/0/fader', 0);
    const engine = new MeterEngine(mixer, {
      signals: { 'in/10': { type: 'tone', db: -12 }, 'in/11': { type: 'tone', db: -30 } },
    });
    engine.frame(0);
    expect(engine.level('out', 0)).toBeCloseTo(-12);
    expect(engine.level('out', 1)).toBeCloseTo(-30);
  });

  it('two sources add up as powers', () => {
    const mixer = mono();
    mixer.setValue('/mix/in/8/0/fader', 0);
    mixer.setValue('/mix/in/10/0/fader', 0);
    const engine = new MeterEngine(mixer, {
      signals: { 'in/8': { type: 'tone', db: -20 }, 'in/10': { type: 'tone', db: -20 } },
    });
    engine.frame(0);
    expect(engine.level('out', 0)).toBeCloseTo(-20 + 10 * Math.log10(2));
  });

  it('the studio set gives every visible input strip a signal and plays music on playback', () => {
    const mixer = studioMixer();
    const signals = meterSignals('studio', mixer);
    expect([...signals.keys()]).toEqual([
      'in/0',
      'in/1',
      'in/8',
      'in/9',
      'in/10',
      'in/11',
      'pb/0',
      'pb/1',
    ]);
    const engine = new MeterEngine(mixer, { signals, random: seeded(1) });
    let frames = 0;
    for (let t = 0; t < 2000; t += FRAME) if (engine.frame(t).length > 0) frames++;
    expect(frames).toBe(50);
    expect(engine.level('out', 0)).toBeGreaterThan(-60); // Main hears the session
  });
});
