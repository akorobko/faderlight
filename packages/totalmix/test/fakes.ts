// Test doubles for the client: a manual clock and a link that records what is sent.
import { float, formatMessage, message, str, type OscMessage } from '@faderlight/osc';
import type { Clock, OscLink, TimerHandle } from '../src/index.ts';

export class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

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

  get pendingTimers(): number {
    return this.timers.size;
  }
}

export class FakeLink implements OscLink {
  up = true;
  readonly sent: { readonly at: number; readonly message: OscMessage }[] = [];
  private readonly clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  send(msg: OscMessage): boolean {
    if (!this.up) return false;
    this.sent.push({ at: this.clock.now(), message: msg });
    return true;
  }

  /** Sent messages as text, e.g. "/sendstate f:1". */
  texts(): string[] {
    return this.sent.map((s) => formatMessage(s.message));
  }

  count(text: string): number {
    return this.texts().filter((t) => t === text).length;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/** TotalMix's reply to /sendstate (serial masked, as in the capture). */
export const statusReply: OscMessage[] = [
  message('/status/device', str('Fireface UFX III (XXXXXXXX)')),
  message('/status/connection', float(1)),
  message('/status/dsp', float(0)),
  message('/durec/state', str('Not ready')),
];
