// FrameScheduler: decides when each key's image is drawn and sent, so a full XL of meters never
// floods the Stream Deck app (docs/design/02-architecture.md, FrameScheduler).
//
// - A global budget of images per second (default 120), kept as a token bucket: every image
//   sent takes a token, tokens come back at the budget rate, and a short burst is allowed.
// - At most `maxKeyFps` images per second for one key (default 15).
// - Two kinds of frames. Static frames (a mute, a name, a page change) are queued in order and
//   go first; they wait for budget but are never dropped. Meter frames (keys that animate at
//   `fps`, or were invalidated as 'meter') are coalesced per key and dropped first when the
//   budget is used up; the next frame of that key simply draws the newer state.
// - Keys are drawn lazily, at send time, from their source, so a frame always shows the latest
//   state, and a frame whose image did not change is not sent at all.

import type { Clock, TimerHandle } from '@faderlight/totalmix';

export type FramePriority = 'static' | 'meter';

/** Draws a key now; undefined means there is nothing to show yet. */
export type FrameSource = () => string | undefined;

/** Sends an image to a key. */
export type FrameSink = (id: string, image: string) => void;

export interface FrameSchedulerOptions {
  /** Images per second for all keys together (default 120). */
  readonly budgetPerSecond: number;
  /** Images per second for one key at most (default 15). */
  readonly maxKeyFps: number;
  /** Images that may go out at once after a quiet period (default a tenth of the budget). */
  readonly burst?: number;
  /** Scheduler tick while there is work (default 1000/60 ms). */
  readonly tickMs?: number;
}

export interface FrameStats {
  /** Times a key was drawn. */
  renders: number;
  /** Images sent. */
  sent: number;
  /** Frames drawn but not sent because the image did not change. */
  unchanged: number;
  /** Meter frames that waited for budget (each then drew a newer frame instead). */
  dropped: number;
}

interface KeyFrames {
  readonly source: FrameSource;
  /** Animation rate in frames per second (meters); 0 = only when invalidated. */
  fps: number;
  /** Last image sent. */
  last: string | undefined;
  lastSentAt: number;
  lastDrawnAt: number;
  /** Waiting for a meter frame. */
  meterDirty: boolean;
  /** Was due but out of budget. */
  waiting: boolean;
}

export class FrameScheduler {
  readonly stats: FrameStats = { renders: 0, sent: 0, unchanged: 0, dropped: 0 };
  private readonly sink: FrameSink;
  private readonly clock: Clock;
  private readonly budget: number;
  private readonly burst: number;
  private readonly minGapMs: number;
  private readonly tickMs: number;
  private readonly keys = new Map<string, KeyFrames>();
  /** Keys waiting for a static frame, in the order they were invalidated. */
  private readonly staticQueue = new Set<string>();
  private tokens: number;
  private refilledAt: number;
  private timer: TimerHandle | undefined;
  private disposed = false;

  constructor(sink: FrameSink, clock: Clock, options: Partial<FrameSchedulerOptions> = {}) {
    this.sink = sink;
    this.clock = clock;
    this.budget = options.budgetPerSecond ?? 120;
    this.burst = Math.max(1, options.burst ?? Math.round(this.budget / 10));
    this.minGapMs = 1000 / (options.maxKeyFps ?? 15);
    this.tickMs = options.tickMs ?? 1000 / 60;
    this.tokens = this.burst;
    this.refilledAt = clock.now();
  }

  /** Starts drawing a key: a static frame right away, then at `fps` if it animates. */
  add(id: string, source: FrameSource, fps = 0): void {
    this.keys.set(id, {
      source,
      fps,
      last: undefined,
      lastSentAt: -Infinity,
      lastDrawnAt: -Infinity,
      meterDirty: false,
      waiting: false,
    });
    this.invalidate(id);
  }

  /** Stops drawing a key. */
  remove(id: string): void {
    this.keys.delete(id);
    this.staticQueue.delete(id);
  }

  has(id: string): boolean {
    return this.keys.has(id);
  }

  /** Changes how often a key animates (0: only when invalidated). */
  setRate(id: string, fps: number): void {
    const k = this.keys.get(id);
    if (!k || k.fps === fps) return;
    k.fps = fps;
    this.wake();
  }

  /** The key's state changed: draw it again. */
  invalidate(id: string, priority: FramePriority = 'static'): void {
    const k = this.keys.get(id);
    if (!k) return;
    if (priority === 'static') this.staticQueue.add(id);
    else k.meterDirty = true;
    this.wake();
  }

  invalidateAll(priority: FramePriority = 'static'): void {
    for (const id of this.keys.keys()) this.invalidate(id, priority);
  }

  /** Forgets the image last sent, so the next frame goes out even if it looks the same. */
  resend(id: string): void {
    const k = this.keys.get(id);
    if (!k) return;
    k.last = undefined;
    this.invalidate(id);
  }

  dispose(): void {
    this.disposed = true;
    this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    this.keys.clear();
    this.staticQueue.clear();
  }

  // --- ticks ------------------------------------------------------------------------------

  private hasWork(): boolean {
    if (this.staticQueue.size > 0) return true;
    for (const k of this.keys.values()) if (k.fps > 0 || k.meterDirty || k.waiting) return true;
    return false;
  }

  /** Runs a tick soon if none is scheduled. */
  private wake(): void {
    if (this.timer !== undefined || this.disposed) return;
    this.timer = this.clock.setTimeout(() => {
      this.tick();
    }, 0);
  }

  private tick(): void {
    this.timer = undefined;
    const now = this.clock.now();
    this.refill(now);
    this.sendStatic(now);
    this.sendMeters(now);
    if (this.hasWork() && !this.disposed) {
      this.timer = this.clock.setTimeout(() => {
        this.tick();
      }, this.tickMs);
    }
  }

  private refill(now: number): void {
    this.tokens = Math.min(
      this.burst,
      this.tokens + ((now - this.refilledAt) * this.budget) / 1000,
    );
    this.refilledAt = now;
  }

  /** Within the per-key limit; a little slack so a frame due between two ticks is not late. */
  private canSend(k: KeyFrames, now: number): boolean {
    return now - k.lastSentAt >= this.minGapMs - 1;
  }

  private sendStatic(now: number): void {
    for (const id of this.staticQueue) {
      const k = this.keys.get(id);
      if (!k) {
        this.staticQueue.delete(id);
        continue;
      }
      if (!this.canSend(k, now)) continue;
      if (this.tokens < 1) return;
      this.staticQueue.delete(id);
      k.meterDirty = false;
      k.waiting = false;
      this.draw(id, k, now);
    }
  }

  private sendMeters(now: number): void {
    const due: [string, KeyFrames][] = [];
    for (const entry of this.keys) {
      const k = entry[1];
      const animating = k.fps > 0 && now - k.lastDrawnAt >= 1000 / k.fps - this.tickMs / 2;
      const wanted = animating || k.meterDirty || k.waiting;
      if (wanted && this.canSend(k, now) && !this.staticQueue.has(entry[0])) {
        due.push(entry);
      }
    }
    // The key that waited longest goes first, so a short budget is shared fairly.
    due.sort((a, b) => a[1].lastSentAt - b[1].lastSentAt);
    for (const [id, k] of due) {
      if (this.tokens < 1) {
        // Out of budget: the key stays due and goes first next time (it has waited longest);
        // by then it draws a newer frame, so this one is dropped.
        if (!k.waiting) this.stats.dropped++;
        k.waiting = true;
        continue;
      }
      k.meterDirty = false;
      k.waiting = false;
      this.draw(id, k, now);
    }
  }

  private draw(id: string, k: KeyFrames, now: number): void {
    const image = k.source();
    k.lastDrawnAt = now;
    this.stats.renders++;
    if (image === undefined || image === k.last) {
      if (image !== undefined) this.stats.unchanged++;
      return;
    }
    k.last = image;
    k.lastSentAt = now;
    this.tokens -= 1;
    this.stats.sent++;
    this.sink(id, image);
  }
}
