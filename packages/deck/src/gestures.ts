// Gesture recogniser: turns one key's down and up events into taps, long presses, double taps
// and auto-repeat ticks (docs/design/03-ux.md §3). One recogniser per key; the clock is
// injected, so tests drive it by hand.
//
// What a press becomes depends on what the key listens for:
// - nothing but taps: the tap fires on key down, for the lowest latency;
// - long press: the tap fires on key up if the key was held less than `longPressMs`, the long
//   press fires while the key is still held, as soon as it reaches `longPressMs`;
// - double tap: a tap waits `doubleTapMs` after key up; a second key down within that window
//   is a double tap instead (and nothing else);
// - repeat (± keys): a tick on key down, then after `delayMs` one every `intervalMs` until key
//   up; no taps or long presses.
// `press` and `release` are always reported too (momentary keys like Talkback use them).

import type { Clock, TimerHandle } from '@faderlight/totalmix';

export interface RepeatOptions {
  /** First repeat after this long (ms). */
  readonly delayMs: number;
  /** Then one every this many ms. */
  readonly intervalMs: number;
}

export interface GestureOptions {
  /** Held this long, a press is a long press; undefined: the key has no long press. */
  readonly longPressMs?: number | undefined;
  /** A second press this soon after a tap is a double tap; undefined: no double tap. */
  readonly doubleTapMs?: number | undefined;
  /** Auto-repeat while held; undefined: no repeat. */
  readonly repeat?: RepeatOptions | undefined;
}

export type Gesture =
  | { readonly type: 'press' }
  | { readonly type: 'release'; readonly heldMs: number }
  | { readonly type: 'tap' }
  | { readonly type: 'doubleTap' }
  | { readonly type: 'longPress' }
  /** count 0 is the key down itself; `heldMs` is the time since key down. */
  | { readonly type: 'repeat'; readonly count: number; readonly heldMs: number };

export type GestureListener = (gesture: Gesture) => void;

export class GestureRecogniser {
  private readonly emit: GestureListener;
  private readonly clock: Clock;
  private options: GestureOptions;
  /** Options of the press in progress (configure() applies from the next press). */
  private active: GestureOptions;
  private down_ = false;
  private pressedAt = 0;
  /** This press already became something (instant tap, long press, double tap, repeat). */
  private consumed = false;
  private holdTimer: TimerHandle | undefined;
  /** Open double-tap window: the first tap fires when it ends. */
  private tapTimer: TimerHandle | undefined;
  private repeatCount = 0;

  constructor(emit: GestureListener, clock: Clock, options: GestureOptions = {}) {
    this.emit = emit;
    this.clock = clock;
    this.options = options;
    this.active = options;
  }

  /** Changes what the key listens for, from the next press on. */
  configure(options: GestureOptions): void {
    this.options = options;
    if (!this.down_ && this.tapTimer === undefined) this.active = options;
  }

  /** The key is held down. */
  get held(): boolean {
    return this.down_;
  }

  /** No press in progress and no double-tap window open: the next press starts a new gesture. */
  get idle(): boolean {
    return !this.down_ && this.tapTimer === undefined;
  }

  down(): void {
    if (this.down_) return;
    const now = this.clock.now();
    this.down_ = true;
    this.pressedAt = now;
    this.consumed = false;
    this.emit({ type: 'press' });

    if (this.tapTimer !== undefined) {
      // Second press inside the double-tap window.
      this.clearTapTimer();
      this.consumed = true;
      this.emit({ type: 'doubleTap' });
      return;
    }
    this.active = this.options;
    const { longPressMs, doubleTapMs, repeat } = this.active;
    if (repeat) {
      this.consumed = true;
      this.repeatCount = 0;
      this.emit({ type: 'repeat', count: 0, heldMs: 0 });
      this.scheduleRepeat(repeat.delayMs);
    } else if (longPressMs !== undefined) {
      this.holdTimer = this.clock.setTimeout(() => {
        this.holdTimer = undefined;
        this.consumed = true;
        this.emit({ type: 'longPress' });
      }, longPressMs);
    } else if (doubleTapMs === undefined) {
      this.consumed = true;
      this.emit({ type: 'tap' });
    }
  }

  up(): void {
    if (!this.down_) return;
    this.down_ = false;
    this.clearHoldTimer();
    this.emit({ type: 'release', heldMs: this.clock.now() - this.pressedAt });
    if (this.consumed) {
      this.active = this.options;
      return;
    }
    const { doubleTapMs } = this.active;
    if (doubleTapMs === undefined) {
      this.emit({ type: 'tap' });
      return;
    }
    this.tapTimer = this.clock.setTimeout(() => {
      this.tapTimer = undefined;
      this.active = this.options;
      this.emit({ type: 'tap' });
    }, doubleTapMs);
  }

  /** The key went away (page change, profile switch): forget the press, report nothing. */
  cancel(): void {
    this.clearHoldTimer();
    this.clearTapTimer();
    this.down_ = false;
    this.consumed = false;
    this.active = this.options;
  }

  private scheduleRepeat(ms: number): void {
    const repeat = this.active.repeat;
    if (!repeat) return;
    this.holdTimer = this.clock.setTimeout(() => {
      this.holdTimer = undefined;
      this.repeatCount++;
      this.emit({
        type: 'repeat',
        count: this.repeatCount,
        heldMs: this.clock.now() - this.pressedAt,
      });
      if (this.down_) this.scheduleRepeat(repeat.intervalMs);
    }, ms);
  }

  private clearHoldTimer(): void {
    this.clock.clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
  }

  private clearTapTimer(): void {
    this.clock.clearTimeout(this.tapTimer);
    this.tapTimer = undefined;
  }
}

/** Step size by how long a repeating key has been held: the last stage it reached. */
export type Acceleration = readonly (readonly [afterMs: number, size: number])[];

/** Volume keys: 0.5 dB per tick, 1 dB after 1.5 s, 3 dB after 3 s (docs/design/03-ux.md §2.2). */
export const VOLUME_ACCELERATION: Acceleration = [
  [0, 0.5],
  [1500, 1],
  [3000, 3],
];

export function stepSize(heldMs: number, stages: Acceleration): number {
  let size = stages[0]?.[1] ?? 1;
  for (const [afterMs, s] of stages) if (heldMs >= afterMs) size = s;
  return size;
}
