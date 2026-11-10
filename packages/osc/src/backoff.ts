// Exponential backoff with jitter, for retrying a socket bind.

export interface BackoffOptions {
  /** First delay (default 250 ms). */
  readonly initialMs: number;
  /** Upper bound for any delay (default 10 s). */
  readonly maxMs: number;
  /** Growth per attempt (default 2). */
  readonly factor: number;
  /** Random spread, 0 to 1: 0.2 means ±20 % (default 0.2). */
  readonly jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  initialMs: 250,
  maxMs: 10_000,
  factor: 2,
  jitter: 0.2,
};

export class Backoff {
  private readonly options: BackoffOptions;
  private readonly random: () => number;
  private attempts = 0;

  constructor(options: Partial<BackoffOptions> = {}, random: () => number = Math.random) {
    this.options = { ...DEFAULT_BACKOFF, ...options };
    this.random = random;
  }

  /** Failed attempts since the last reset. */
  get attempt(): number {
    return this.attempts;
  }

  /** Delay before the next attempt; each call counts one more failure. */
  next(): number {
    const { initialMs, maxMs, factor, jitter } = this.options;
    const base = Math.min(maxMs, initialMs * factor ** this.attempts);
    this.attempts++;
    const spread = base * jitter * (this.random() * 2 - 1);
    return Math.round(Math.max(0, Math.min(maxMs, base + spread)));
  }

  reset(): void {
    this.attempts = 0;
  }
}
