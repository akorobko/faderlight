// A manual clock for tests: time moves only when advance() is called.
import type { Clock, TimerHandle } from '@faderlight/totalmix';

export class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  constructor(start = 0) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + Math.max(0, ms), callback });
    return id;
  }

  clearTimeout(handle: TimerHandle | undefined): void {
    if (typeof handle === 'number') this.timers.delete(handle);
  }

  /** Timers waiting to fire. */
  get pending(): number {
    return this.timers.size;
  }

  /** Moves time forward, firing due timers in order (earliest first, then oldest). */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let next: [number, { at: number; callback: () => void }] | undefined;
      for (const entry of this.timers) {
        if (entry[1].at > end) continue;
        if (!next || entry[1].at < next[1].at) next = entry;
      }
      if (!next) break;
      this.timers.delete(next[0]);
      this.time = next[1].at;
      next[1].callback();
    }
    this.time = end;
  }
}
