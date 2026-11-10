// Meter levels: one ring buffer of recent levels per channel, read as {level, peak, clip}.
//
// TotalMix sends display levels in dBFS that already carry its own ballistics, and only the
// meters that changed in each 40 ms frame (docs/protocol/global-osc.md §5). So the latest level
// stays valid until a new one arrives; the buffer adds peak hold and clip hold on top.

import type { Bus } from './targets.ts';

export interface MeterOptions {
  /** Levels kept per channel (default 128, about 5 s at TotalMix's 25 frames/s). */
  readonly capacity: number;
  /** Peak hold window (default 1500 ms). */
  readonly peakHoldMs: number;
  /** How long a clip stays lit after the last over (default 3000 ms). */
  readonly clipHoldMs: number;
  /** Level that marks an over. TotalMix reports an over as +6 dB (default 6). */
  readonly clipDb: number;
  /** Level shown for silence and for channels without data (default -100, TotalMix's floor). */
  readonly floorDb: number;
}

export const DEFAULT_METER_OPTIONS: MeterOptions = {
  capacity: 128,
  peakHoldMs: 1500,
  clipHoldMs: 3000,
  clipDb: 6,
  floorDb: -100,
};

export interface MeterReading {
  /** Latest level in dBFS. */
  readonly level: number;
  /** Highest level within the peak hold window (never below `level`). */
  readonly peak: number;
  /** An over within the clip hold window. */
  readonly clip: boolean;
}

// Float32 storage rounds +6 to exactly 6, but leave room for senders that do not.
const CLIP_TOLERANCE_DB = 0.05;

class MeterRing {
  private readonly times: Float64Array;
  private readonly levels: Float32Array;
  private next = 0;
  private size = 0;
  /** Levels before this time no longer count for peak and clip hold (clearHold). */
  heldFrom = -Infinity;

  constructor(capacity: number) {
    this.times = new Float64Array(capacity);
    this.levels = new Float32Array(capacity);
  }

  push(at: number, db: number): void {
    this.times[this.next] = at;
    this.levels[this.next] = db;
    this.next = (this.next + 1) % this.times.length;
    if (this.size < this.times.length) this.size++;
  }

  /** Newest first: calls `visit(at, db)` until it returns false or the buffer ends. */
  scan(visit: (at: number, db: number) => boolean): void {
    const n = this.times.length;
    for (let i = 0; i < this.size; i++) {
      const slot = (this.next - 1 - i + n) % n;
      if (!visit(this.times[slot] ?? 0, this.levels[slot] ?? 0)) return;
    }
  }

  latest(): number | undefined {
    if (this.size === 0) return undefined;
    return this.levels[(this.next - 1 + this.levels.length) % this.levels.length];
  }
}

export class MeterBank {
  readonly options: MeterOptions;
  private readonly rings = new Map<string, MeterRing>();

  constructor(options: Partial<MeterOptions> = {}) {
    this.options = { ...DEFAULT_METER_OPTIONS, ...options };
  }

  private static key(bus: Bus, index: number): string {
    return `${bus}/${String(index)}`;
  }

  /** Records a level (dBFS) that arrived at time `at` (ms). */
  push(bus: Bus, index: number, db: number, at: number): void {
    const key = MeterBank.key(bus, index);
    let ring = this.rings.get(key);
    if (!ring) {
      ring = new MeterRing(this.options.capacity);
      this.rings.set(key, ring);
    }
    ring.push(at, db);
  }

  /** True once a level has arrived for the channel. */
  has(bus: Bus, index: number): boolean {
    return this.rings.has(MeterBank.key(bus, index));
  }

  /** Level, peak and clip at time `now` (ms). Channels without data read as the floor. */
  read(bus: Bus, index: number, now: number): MeterReading {
    const { floorDb, peakHoldMs, clipHoldMs, clipDb } = this.options;
    const ring = this.rings.get(MeterBank.key(bus, index));
    const level = ring?.latest() ?? floorDb;
    let peak = level;
    let clip = false;
    const oldest = Math.max(now - Math.max(peakHoldMs, clipHoldMs), ring?.heldFrom ?? -Infinity);
    ring?.scan((at, db) => {
      if (at < oldest) return false;
      if (at >= now - peakHoldMs && db > peak) peak = db;
      if (at >= now - clipHoldMs && db >= clipDb - CLIP_TOLERANCE_DB) clip = true;
      return true;
    });
    return { level, peak, clip };
  }

  /** Clears a channel's peak and clip hold: only levels from `now` on count again. */
  clearHold(bus: Bus, index: number, now: number): void {
    const ring = this.rings.get(MeterBank.key(bus, index));
    if (ring) ring.heldFrom = now;
  }

  /** Forgets every level, e.g. when the connection is lost. */
  reset(): void {
    this.rings.clear();
  }
}
