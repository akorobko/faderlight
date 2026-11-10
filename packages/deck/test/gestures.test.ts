import { beforeEach, describe, expect, it } from 'vitest';
import {
  GestureRecogniser,
  stepSize,
  VOLUME_ACCELERATION,
  type Gesture,
  type GestureOptions,
} from '../src/index.ts';
import { FakeClock } from './clock.ts';

let clock: FakeClock;
let seen: string[];

/** A recogniser whose gestures are recorded as "t:type" strings. */
function key(options: GestureOptions): GestureRecogniser {
  return new GestureRecogniser(
    (g: Gesture) => {
      seen.push(
        `${String(clock.now())}:${g.type}${g.type === 'repeat' ? String(g.count) : ''}${
          g.type === 'release' ? `(${String(g.heldMs)})` : ''
        }`,
      );
    },
    clock,
    options,
  );
}

/** Presses for `ms`, then releases. */
function press(k: GestureRecogniser, ms: number): void {
  k.down();
  clock.advance(ms);
  k.up();
}

beforeEach(() => {
  clock = new FakeClock();
  seen = [];
});

describe('GestureRecogniser', () => {
  it('fires a tap on key down when the key only has taps', () => {
    const k = key({});
    k.down();
    expect(seen).toEqual(['0:press', '0:tap']);
    clock.advance(80);
    k.up();
    expect(seen).toEqual(['0:press', '0:tap', '80:release(80)']);
  });

  it('fires a tap on key up when the key also has a long press', () => {
    press(key({ longPressMs: 450 }), 120);
    expect(seen).toEqual(['0:press', '120:release(120)', '120:tap']);
  });

  it('fires the long press at the threshold while held, and no tap after it', () => {
    const k = key({ longPressMs: 450 });
    k.down();
    clock.advance(449);
    expect(seen).toEqual(['0:press']);
    clock.advance(1);
    expect(seen).toEqual(['0:press', '450:longPress']);
    clock.advance(300);
    k.up();
    expect(seen).toEqual(['0:press', '450:longPress', '750:release(750)']);
  });

  it('delays a tap by the double-tap window', () => {
    press(key({ doubleTapMs: 250 }), 50);
    expect(seen).toEqual(['0:press', '50:release(50)']);
    clock.advance(250);
    expect(seen).toEqual(['0:press', '50:release(50)', '300:tap']);
  });

  it('reports a second press inside the window as a double tap, without taps', () => {
    const k = key({ doubleTapMs: 250, longPressMs: 450 });
    press(k, 50);
    clock.advance(100);
    k.down();
    clock.advance(600); // held long, but it is the second press of a double tap
    k.up();
    clock.advance(1000);
    expect(seen).toEqual([
      '0:press',
      '50:release(50)',
      '150:press',
      '150:doubleTap',
      '750:release(600)',
    ]);
  });

  it('starts over after the window: two slow taps are two taps', () => {
    const k = key({ doubleTapMs: 250 });
    press(k, 50);
    clock.advance(300);
    press(k, 50);
    clock.advance(300);
    expect(seen.filter((s) => s.endsWith(':tap'))).toEqual(['300:tap', '650:tap']);
  });

  it('repeats while held: a tick on key down, then after the delay at the interval', () => {
    const k = key({ repeat: { delayMs: 400, intervalMs: 100 }, longPressMs: 450 });
    k.down();
    clock.advance(650);
    k.up();
    clock.advance(500);
    expect(seen).toEqual([
      '0:press',
      '0:repeat0',
      '400:repeat1',
      '500:repeat2',
      '600:repeat3',
      '650:release(650)',
    ]);
  });

  it('ignores a second key down and a key up without key down', () => {
    const k = key({});
    k.up();
    k.down();
    k.down();
    expect(seen).toEqual(['0:press', '0:tap']);
    expect(k.held).toBe(true);
  });

  it('forgets a press when cancelled, with no events and no timers left', () => {
    const k = key({ longPressMs: 450, doubleTapMs: 250 });
    k.down();
    k.cancel();
    clock.advance(1000);
    press(k, 50);
    k.cancel();
    clock.advance(1000);
    expect(seen).toEqual(['0:press', '1000:press', '1050:release(50)']);
    expect(clock.pending).toBe(0);
  });

  it('applies new options from the next press', () => {
    const k = key({});
    k.down();
    k.configure({ longPressMs: 450 });
    clock.advance(500);
    k.up();
    press(k, 500);
    expect(seen).toEqual([
      '0:press',
      '0:tap',
      '500:release(500)',
      '500:press',
      '950:longPress',
      '1000:release(500)',
    ]);
  });
});

describe('stepSize', () => {
  it('grows with the time held', () => {
    expect(stepSize(0, VOLUME_ACCELERATION)).toBe(0.5);
    expect(stepSize(1499, VOLUME_ACCELERATION)).toBe(0.5);
    expect(stepSize(1500, VOLUME_ACCELERATION)).toBe(1);
    expect(stepSize(5000, VOLUME_ACCELERATION)).toBe(3);
  });
});
