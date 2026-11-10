import { describe, expect, it } from 'vitest';
import { FaultInjector } from '../src/index.ts';
import { seeded } from './helpers.ts';

describe('FaultInjector', () => {
  it('passes everything through without faults', () => {
    const f = new FaultInjector();
    for (let i = 0; i < 100; i++) {
      expect(f.dropIn()).toBe(false);
      expect(f.outgoing(480)).toEqual({ drop: false, delayMs: 0 });
    }
  });

  it('drops about the given share of datagrams in each direction', () => {
    const f = new FaultInjector({ dropIncoming: 0.25, dropOutgoing: 0.5 }, seeded(7));
    let inDropped = 0;
    let outDropped = 0;
    for (let i = 0; i < 2000; i++) {
      if (f.dropIn()) inDropped++;
      if (f.outgoing(100).drop) outDropped++;
    }
    expect(inDropped / 2000).toBeCloseTo(0.25, 1);
    expect(outDropped / 2000).toBeCloseTo(0.5, 1);
    expect(f.stats).toEqual({
      droppedIncoming: inDropped,
      droppedOutgoing: outDropped,
      droppedBandwidth: 0,
    });
  });

  it('adds latency and up to `jitterMs` of random delay', () => {
    const f = new FaultInjector({ latencyMs: 30, jitterMs: 20 }, seeded(2));
    for (let i = 0; i < 200; i++) {
      const v = f.outgoing(100);
      if (v.drop) throw new Error('dropped');
      expect(v.delayMs).toBeGreaterThanOrEqual(30);
      expect(v.delayMs).toBeLessThan(50);
    }
  });

  it('drops what goes over the bandwidth budget and refills it over time', () => {
    let now = 0;
    const f = new FaultInjector({ bandwidthBytesPerSec: 10_000 }, Math.random, () => now);
    // The budget holds 100 ms of traffic: 1000 bytes, two 480-byte datagrams.
    expect(f.outgoing(480).drop).toBe(false);
    expect(f.outgoing(480).drop).toBe(false);
    expect(f.outgoing(480)).toEqual({ drop: true, reason: 'bandwidth' });
    now += 48; // 480 bytes more
    expect(f.outgoing(480).drop).toBe(false);
    expect(f.stats.droppedBandwidth).toBe(1);
  });

  it('changes options on the fly and rejects nonsense', () => {
    const f = new FaultInjector();
    f.update({ dropOutgoing: 1 });
    expect(f.outgoing(10)).toEqual({ drop: true, reason: 'loss' });
    expect(f.options.dropOutgoing).toBe(1);
    expect(() => {
      f.update({ dropIncoming: 2 });
    }).toThrow(RangeError);
    expect(() => new FaultInjector({ latencyMs: -1 })).toThrow(RangeError);
  });
});
