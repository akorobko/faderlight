// MixerStore: the single source of truth for mixer state, fed by an adaptor.
//
// Every value is an entry with a state:
// - confirmed: the device reported it.
// - pending: written by us and not confirmed yet. The device does not echo writes (TotalMix
//   sends nothing back for numeric writes, docs/protocol/global-osc.md §4), so the adaptor asks
//   for the value again and the reply settles the entry:
//     setPending(target, v)  -> pending; the write goes out
//     awaitReply(target)     -> the confirming request went out; from now on the device's
//                               answer wins, even if it differs (that is a correction)
//     a device value         -> equal to v, or after awaitReply: confirmed with that value;
//                               different before awaitReply: kept aside, still pending (it may
//                               be an old reply that crossed our write)
//     rollback(target)       -> no answer in time: back to the last device value (or unknown)
//
// Change events are synchronous and batched: one event per applyDevice() call or batch().
// Meter levels live in `meters` and raise no events; renderers read them at frame time.

import { MeterBank, type MeterOptions } from './meters.ts';
import { keyOf, type Key, type Target, type Value } from './targets.ts';

export type EntryState = 'confirmed' | 'pending';

export interface Entry {
  readonly target: Target;
  readonly value: Value;
  readonly state: EntryState;
}

export interface Update {
  readonly target: Target;
  readonly value: Value;
}

/**
 * idle: not running or no socket. probing: asking whether the device answers. syncing: reading
 * the full state. live: in sync and answering. stale: was live, stopped answering; values are
 * the last known ones.
 */
export type ConnectionState = 'idle' | 'probing' | 'syncing' | 'live' | 'stale';

export interface StoreChange {
  /** Keys whose value or state changed (added, changed, removed). */
  readonly keys: ReadonlySet<Key>;
  /** The connection state changed. */
  readonly connection: boolean;
}

export type StoreListener = (change: StoreChange) => void;

interface Slot {
  target: Target;
  value: Value;
  state: EntryState;
  /** Last value the device reported; undefined if it never did. */
  device: Value | undefined;
  /** The confirming request has gone out (pending entries only). */
  awaitingReply: boolean;
  /** Sync generation in which the device last reported this entry. */
  seen: number;
}

/** Same value, treating numbers that are equal as float32 as equal (the wire is float32). */
export function sameValue(a: Value, b: Value): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b || Math.fround(a) === Math.fround(b);
  }
  return a === b;
}

export class MixerStore {
  readonly meters: MeterBank;
  private readonly slots = new Map<Key, Slot>();
  private readonly listeners = new Set<StoreListener>();
  private connectionState: ConnectionState = 'idle';
  private depth = 0;
  private changedKeys = new Set<Key>();
  private connectionChanged = false;
  private generation = 0;
  private syncing = false;
  private everSynced = false;

  constructor(options: { readonly meters?: Partial<MeterOptions> } = {}) {
    this.meters = new MeterBank(options.meters);
  }

  // --- reading --------------------------------------------------------------------------

  get connection(): ConnectionState {
    return this.connectionState;
  }

  /** True after a full sync completed; then a missing route means it is off. */
  get synced(): boolean {
    return this.everSynced;
  }

  get size(): number {
    return this.slots.size;
  }

  get(target: Target): Entry | undefined {
    return this.getKey(keyOf(target));
  }

  getKey(key: Key): Entry | undefined {
    const s = this.slots.get(key);
    return s && { target: s.target, value: s.value, state: s.state };
  }

  value(target: Target): Value | undefined {
    return this.slots.get(keyOf(target))?.value;
  }

  isPending(target: Target): boolean {
    return this.slots.get(keyOf(target))?.state === 'pending';
  }

  *entries(): IterableIterator<Entry> {
    for (const s of this.slots.values()) yield { target: s.target, value: s.value, state: s.state };
  }

  // --- events ---------------------------------------------------------------------------

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Runs `fn` and raises one change event for everything it changed. */
  batch<T>(fn: () => T): T {
    this.depth++;
    try {
      return fn();
    } finally {
      this.depth--;
      if (this.depth === 0) this.flush();
    }
  }

  private flush(): void {
    if (this.changedKeys.size === 0 && !this.connectionChanged) return;
    const change: StoreChange = { keys: this.changedKeys, connection: this.connectionChanged };
    this.changedKeys = new Set();
    this.connectionChanged = false;
    for (const listener of this.listeners) listener(change);
  }

  private touched(key: Key): void {
    this.changedKeys.add(key);
  }

  // --- writing --------------------------------------------------------------------------

  setConnection(state: ConnectionState): void {
    if (state === this.connectionState) return;
    this.batch(() => {
      this.connectionState = state;
      this.connectionChanged = true;
    });
  }

  /** Values reported by the device. */
  applyDevice(updates: readonly Update[]): void {
    if (updates.length === 0) return;
    this.batch(() => {
      for (const u of updates) this.applyOne(u);
    });
  }

  private applyOne({ target, value }: Update): void {
    const key = keyOf(target);
    const s = this.slots.get(key);
    if (!s) {
      this.slots.set(key, {
        target,
        value,
        state: 'confirmed',
        device: value,
        awaitingReply: false,
        seen: this.generation,
      });
      this.touched(key);
      return;
    }
    s.device = value;
    s.seen = this.generation;
    if (s.state === 'pending') {
      if (s.awaitingReply || sameValue(s.value, value)) {
        s.state = 'confirmed';
        s.value = value;
        s.awaitingReply = false;
        this.touched(key);
      }
      return;
    }
    if (!sameValue(s.value, value)) {
      s.value = value;
      this.touched(key);
    }
  }

  /** Shows a value we are writing, before the device confirms it. */
  setPending(target: Target, value: Value): void {
    const key = keyOf(target);
    this.batch(() => {
      const s = this.slots.get(key);
      if (s) {
        s.value = value;
        s.state = 'pending';
        s.awaitingReply = false;
      } else {
        this.slots.set(key, {
          target,
          value,
          state: 'pending',
          device: undefined,
          awaitingReply: false,
          seen: -1,
        });
      }
      this.touched(key);
    });
  }

  /** The request that reports this target's value has been sent: its answer settles it. */
  awaitReply(target: Target): void {
    const s = this.slots.get(keyOf(target));
    if (s?.state === 'pending') s.awaitingReply = true;
  }

  /** Abandons a pending value: back to the last device value, or unknown. Returns true if it was pending. */
  rollback(target: Target): boolean {
    const key = keyOf(target);
    const s = this.slots.get(key);
    if (s?.state !== 'pending') return false;
    this.batch(() => {
      if (s.device === undefined) {
        this.slots.delete(key);
      } else {
        s.value = s.device;
        s.state = 'confirmed';
        s.awaitingReply = false;
      }
      this.touched(key);
    });
    return true;
  }

  // --- full sync ------------------------------------------------------------------------

  /** A full state dump starts: entries it does not report will be removed by endSync(). */
  beginSync(): void {
    this.generation++;
    this.syncing = true;
  }

  /**
   * The dump is complete. Removes confirmed entries it did not report: channels that are
   * hidden now, routes that are off (a dump of routes that are on leaves them out).
   */
  endSync(): void {
    if (!this.syncing) return;
    this.syncing = false;
    this.everSynced = true;
    this.batch(() => {
      for (const [key, s] of this.slots) {
        if (s.state === 'confirmed' && s.seen !== this.generation) {
          this.slots.delete(key);
          this.touched(key);
        }
      }
    });
  }

  /** The dump did not complete: keep everything. */
  abortSync(): void {
    this.syncing = false;
  }

  /** Forgets all values and meters (another device, or a reset). */
  clear(): void {
    this.batch(() => {
      for (const key of this.slots.keys()) this.touched(key);
      this.slots.clear();
      this.everSynced = false;
      this.syncing = false;
    });
    this.meters.reset();
  }
}
