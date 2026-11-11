import { beforeEach, describe, expect, it } from 'vitest';
import { renderKey, type ChannelKey } from '@faderlight/render';
import { FrameScheduler, type FrameSchedulerOptions } from '../src/index.ts';
import { FakeClock } from './clock.ts';

let clock: FakeClock;
/** Images sent: [time, key id, image]. */
let sent: [number, string, string][];

function scheduler(options: Partial<FrameSchedulerOptions> = {}): FrameScheduler {
  return new FrameScheduler(
    (id, image) => {
      sent.push([clock.now(), id, image]);
    },
    clock,
    options,
  );
}

/** A key whose image changes on every draw. */
function changing(name: string): () => string {
  let n = 0;
  return () => `${name}#${String(n++)}`;
}

const sentTo = (id: string) => sent.filter((s) => s[1] === id);

beforeEach(() => {
  clock = new FakeClock();
  sent = [];
});

describe('FrameScheduler', () => {
  it('draws a key as soon as it is added and skips images that did not change', () => {
    const s = scheduler();
    let image = 'a';
    s.add('k', () => image);
    clock.advance(0);
    expect(sent).toEqual([[0, 'k', 'a']]);
    // Each wait is longer than the gap between two images of one key (100 ms at 10 per second).
    s.invalidate('k');
    clock.advance(150);
    expect(sent).toHaveLength(1);
    expect(s.stats.unchanged).toBe(1);
    image = 'b';
    s.invalidate('k');
    clock.advance(150);
    expect(sent.map((x) => x[2])).toEqual(['a', 'b']);
  });

  it('limits one key to maxKeyFps and always ends on the latest state', () => {
    const s = scheduler({ maxKeyFps: 15 });
    let value = 0;
    s.add('fader', () => `v${String(value)}`);
    // A fader drag in the mixer: a change every 20 ms for one second.
    for (let t = 0; t < 1000; t += 20) {
      value++;
      s.invalidate('fader');
      clock.advance(20);
    }
    clock.advance(200);
    const frames = sentTo('fader');
    expect(frames.length).toBeLessThanOrEqual(16);
    expect(frames.at(-1)?.[2]).toBe(`v${String(value)}`);
    for (let i = 1; i < frames.length; i++) {
      expect((frames[i]?.[0] ?? 0) - (frames[i - 1]?.[0] ?? 0)).toBeGreaterThanOrEqual(65);
    }
  });

  it('does not resend animated keys whose image stays the same', () => {
    const s = scheduler();
    for (let i = 0; i < 32; i++) s.add(`silent${String(i)}`, () => 'quiet', 12);
    clock.advance(5000);
    expect(sent).toHaveLength(32);
    expect(s.stats.unchanged).toBeGreaterThan(32 * 12 * 4);
  });

  it('sends a forced resend even when the image is the same', () => {
    const s = scheduler();
    s.add('k', () => 'same');
    clock.advance(100);
    s.resend('k');
    clock.advance(100);
    expect(sent).toHaveLength(2);
  });

  it('stops drawing removed keys and stops ticking once idle', () => {
    const s = scheduler();
    s.add('meter', changing('m'), 15);
    clock.advance(500);
    const before = sent.length;
    s.remove('meter');
    clock.advance(500);
    expect(sent).toHaveLength(before);
    expect(clock.pending).toBe(0);
  });

  it('keeps a static frame waiting for budget, but never drops it', () => {
    const s = scheduler({ budgetPerSecond: 10, burst: 1 });
    s.add('a', () => 'a');
    s.add('b', () => 'b');
    s.add('c', () => 'c');
    clock.advance(0);
    expect(sent.map((x) => x[1])).toEqual(['a']);
    clock.advance(250);
    expect(sent.map((x) => x[1])).toEqual(['a', 'b', 'c']);
  });

  describe('load: 32 keys of meters at 15 fps on a 120 images/s budget', () => {
    const run = () => {
      const s = scheduler({ budgetPerSecond: 120, maxKeyFps: 15 });
      for (let i = 0; i < 32; i++) s.add(`m${String(i)}`, changing(`m${String(i)}`), 15);
      // A mute in the middle of it: a static frame for another key.
      let muted = false;
      clock.advance(5000);
      s.add('mute', () => (muted ? 'muted' : 'open'));
      clock.advance(1000);
      const at = clock.now();
      muted = true;
      s.invalidate('mute');
      clock.advance(5000);
      s.dispose();
      return { s, at };
    };

    it('stays within the budget in every second', () => {
      run();
      const burst = 12;
      for (let t = 0; t < 11000; t += 1000) {
        const inWindow = sent.filter(([at]) => at >= t && at < t + 1000).length;
        expect(inWindow, `second ${String(t / 1000)}`).toBeLessThanOrEqual(120 + burst);
      }
      expect(sent.length).toBeGreaterThan(120 * 11 * 0.9);
    });

    it('shares the budget fairly and keeps every key within its own limit', () => {
      run();
      for (let i = 0; i < 32; i++) {
        const frames = sentTo(`m${String(i)}`).filter(([at]) => at >= 1000);
        // 120 / 32 = 3.75 frames per second each over 10 s.
        expect(frames.length, `key m${String(i)}`).toBeGreaterThanOrEqual(30);
        expect(frames.length).toBeLessThanOrEqual(150);
      }
    });

    it('sends a static change ahead of the meters, within a frame and a tick', () => {
      const { s, at } = run();
      const frame = sentTo('mute').find(([, , image]) => image === 'muted');
      expect(frame).toBeDefined();
      expect((frame?.[0] ?? Infinity) - at).toBeLessThanOrEqual(1000 / 15 + 1000 / 60);
      expect(s.stats.dropped).toBeGreaterThan(0);
    });
  });

  it('draws 32 real channel keys at 15 fps faster than real time', () => {
    const keys = Array.from({ length: 32 }, (_, i): ChannelKey => ({
      kind: 'channel',
      label: `IN ${String(i + 1)}`,
      name: `Channel ${String(i + 1)}`,
      color: (i % 8) + 1,
      value: { kind: 'gain', db: 30, caption: 'Gain' },
      meter: { left: { level: -20, peak: -12, clip: false } },
    }));
    const s = scheduler({ budgetPerSecond: 500, maxKeyFps: 15 });
    let t = 0;
    keys.forEach((k, i) => {
      s.add(
        `k${String(i)}`,
        () => {
          const level = -40 + ((t++ * 7) % 38);
          return renderKey(
            { ...k, meter: { left: { level, peak: level + 3, clip: false } } },
            undefined,
            96,
          );
        },
        15,
      );
    });
    renderKey(keys[0] ?? { kind: 'status', link: 'idle' }); // loads the fonts outside the timing
    const start = performance.now();
    clock.advance(1000);
    const elapsed = performance.now() - start;
    s.dispose();
    expect(s.stats.renders).toBeGreaterThanOrEqual(32 * 14);
    expect(elapsed).toBeLessThan(1000);
  });
});
