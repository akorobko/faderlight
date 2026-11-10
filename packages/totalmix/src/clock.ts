// Time source for the client, so tests can drive timers by hand.

/** Whatever the clock's setTimeout returns (a Node Timeout object, or a number in tests). */
export type TimerHandle = object | number;

export interface Clock {
  /** Milliseconds on a monotonic clock. */
  now(): number;
  setTimeout(callback: () => void, ms: number): TimerHandle;
  /** Ignores undefined, like the global clearTimeout. */
  clearTimeout(handle: TimerHandle | undefined): void;
}

export const systemClock: Clock = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => {
    if (typeof handle === 'object') clearTimeout(handle as NodeJS.Timeout);
  },
};
