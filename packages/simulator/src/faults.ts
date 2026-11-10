// Network faults for testing how a client copes: lost datagrams, latency and jitter, and a
// bandwidth limit. Quitting and restarting TotalMix, and sample-rate changes, are methods of
// the simulator and the mixer instead.

export interface FaultOptions {
  /** Share of received datagrams dropped before TotalMix sees them, 0 to 1. */
  readonly dropIncoming: number;
  /** Share of sent datagrams dropped, 0 to 1. */
  readonly dropOutgoing: number;
  /** Extra delay before every sent datagram, in ms. */
  readonly latencyMs: number;
  /** Random extra delay of up to this many ms per datagram; datagrams can overtake each other. */
  readonly jitterMs: number;
  /**
   * Outgoing bandwidth in bytes per second, 0 for no limit. Datagrams over the budget are
   * dropped, like on a congested link. The budget refills continuously and holds at most
   * 100 ms worth of traffic (at least one full datagram).
   */
  readonly bandwidthBytesPerSec: number;
}

export const NO_FAULTS: FaultOptions = {
  dropIncoming: 0,
  dropOutgoing: 0,
  latencyMs: 0,
  jitterMs: 0,
  bandwidthBytesPerSec: 0,
};

export interface FaultStats {
  droppedIncoming: number;
  droppedOutgoing: number;
  /** Outgoing datagrams dropped by the bandwidth limit. */
  droppedBandwidth: number;
}

export type OutgoingVerdict =
  | { readonly drop: true; readonly reason: 'loss' | 'bandwidth' }
  | { readonly drop: false; readonly delayMs: number };

export class FaultInjector {
  readonly stats: FaultStats = { droppedIncoming: 0, droppedOutgoing: 0, droppedBandwidth: 0 };
  private current: FaultOptions;
  private readonly random: () => number;
  private readonly now: () => number;
  private tokens = 0;
  private refilledAt: number;

  constructor(
    options: Partial<FaultOptions> = {},
    random: () => number = Math.random,
    now: () => number = () => performance.now(),
  ) {
    this.current = check({ ...NO_FAULTS, ...options });
    this.random = random;
    this.now = now;
    this.refilledAt = now();
    this.tokens = this.capacity();
  }

  get options(): FaultOptions {
    return this.current;
  }

  /** Changes some options; the rest stay. */
  update(options: Partial<FaultOptions>): void {
    this.current = check({ ...this.current, ...options });
    this.tokens = Math.min(this.tokens, this.capacity());
  }

  /** True when a received datagram is lost. */
  dropIn(): boolean {
    const drop = this.current.dropIncoming > 0 && this.random() < this.current.dropIncoming;
    if (drop) this.stats.droppedIncoming++;
    return drop;
  }

  /** What happens to a datagram of `size` bytes about to be sent. */
  outgoing(size: number): OutgoingVerdict {
    const o = this.current;
    if (o.dropOutgoing > 0 && this.random() < o.dropOutgoing) {
      this.stats.droppedOutgoing++;
      return { drop: true, reason: 'loss' };
    }
    if (o.bandwidthBytesPerSec > 0) {
      this.refill();
      if (this.tokens < size) {
        this.stats.droppedBandwidth++;
        return { drop: true, reason: 'bandwidth' };
      }
      this.tokens -= size;
    }
    const jitter = o.jitterMs > 0 ? this.random() * o.jitterMs : 0;
    return { drop: false, delayMs: o.latencyMs + jitter };
  }

  private capacity(): number {
    return Math.max(480, this.current.bandwidthBytesPerSec / 10);
  }

  private refill(): void {
    const now = this.now();
    const elapsed = Math.max(0, now - this.refilledAt);
    this.refilledAt = now;
    this.tokens = Math.min(
      this.capacity(),
      this.tokens + (this.current.bandwidthBytesPerSec * elapsed) / 1000,
    );
  }
}

function check(o: FaultOptions): FaultOptions {
  for (const key of ['dropIncoming', 'dropOutgoing'] as const) {
    if (!(o[key] >= 0 && o[key] <= 1)) throw new RangeError(`${key} must be between 0 and 1`);
  }
  for (const key of ['latencyMs', 'jitterMs', 'bandwidthBytesPerSec'] as const) {
    if (!(o[key] >= 0 && Number.isFinite(o[key]))) {
      throw new RangeError(`${key} must be 0 or more`);
    }
  }
  return o;
}
