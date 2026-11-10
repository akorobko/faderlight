// Meter levels: per-channel test signals, TotalMix's meter ballistics and the frames it sends.
//
// Seen in the capture (docs/protocol/global-osc.md §5, Meters): `/level/{in|pb|out}/{n}`, one
// float32 display level in dBFS per physical channel, floor −100. Levels fall 0.6 dB per frame;
// an over shows as +6, held for about 2 s, then falls 0.8 dB per frame. A frame comes every
// 40 ms and holds only the meters that changed; after a start TotalMix sends one complete frame.
// Only visible channels have meters on the wire.
//
// Output meters follow the mix unless a signal is set for them: every source routed to the
// output (route fader above off, source not muted) adds its level plus the route fader, and the
// output's own volume and mute apply on top. Pan and balance are ignored.

import type { Bus } from '@faderlight/model';
import { float, message, type OscMessage } from '@faderlight/osc';
import { OFF_DB } from './fields.ts';
import type { RouteSource, SimMixer } from './mixer.ts';

export const METER_FLOOR_DB = -100;
export const METER_OVER_DB = 6;
export const METER_FRAME_MS = 40;
export const METER_FALL_DB = 0.6;
export const METER_OVER_FALL_DB = 0.8;
export const METER_OVER_HOLD_MS = 2000;

/**
 * A test signal, as its peak level per frame in dBFS:
 * - silence: nothing.
 * - tone: a steady level.
 * - noise: random peaks around `db`, ± `spreadDb` (default 3).
 * - drums: a hit every beat at `peakDb`, decaying by `decayDbPerSec` (default 60) down to −70;
 *   every `clipEvery`th hit goes over 0 dBFS.
 * - sweep: the level ramps from `fromDb` to `toDb` over `periodMs`, then starts again.
 */
export type Signal =
  | { readonly type: 'silence' }
  | { readonly type: 'tone'; readonly db: number }
  | { readonly type: 'noise'; readonly db: number; readonly spreadDb?: number }
  | {
      readonly type: 'drums';
      readonly bpm: number;
      readonly peakDb: number;
      readonly clipEvery?: number;
      readonly decayDbPerSec?: number;
    }
  | {
      readonly type: 'sweep';
      readonly fromDb: number;
      readonly toDb: number;
      readonly periodMs: number;
    };

/** Meter bus names on the wire. */
export type MeterBus = 'in' | 'pb' | 'out';

const METER_BUS: Readonly<Record<MeterBus, Bus>> = { in: 'input', pb: 'playback', out: 'output' };
const BUS_ORDER: readonly MeterBus[] = ['in', 'pb', 'out'];

/** Peak level of a signal in the frame that ends at `t` ms; −Infinity for no signal. */
export function signalPeak(signal: Signal, t: number, random: () => number): number {
  switch (signal.type) {
    case 'silence':
      return -Infinity;
    case 'tone':
      return signal.db;
    case 'noise': {
      const spread = signal.spreadDb ?? 3;
      return signal.db + spread * (random() * 2 - 1);
    }
    case 'drums': {
      const beatMs = 60_000 / signal.bpm;
      const beat = Math.floor(t / beatMs);
      const since = t - beat * beatMs;
      const clip = signal.clipEvery !== undefined && (beat + 1) % signal.clipEvery === 0;
      const peak = clip ? 1 : signal.peakDb;
      return Math.max(-70, peak - ((signal.decayDbPerSec ?? 60) * since) / 1000);
    }
    case 'sweep': {
      const phase = (((t % signal.periodMs) + signal.periodMs) % signal.periodMs) / signal.periodMs;
      return signal.fromDb + (signal.toDb - signal.fromDb) * phase;
    }
  }
}

/** One meter's display level with TotalMix's ballistics, advanced frame by frame. */
export class MeterBallistics {
  private current = METER_FLOOR_DB;
  private holdUntil = -Infinity;
  private afterOver = false;

  get level(): number {
    return this.current;
  }

  /** Advances one frame with the signal's peak in it (dBFS) and returns the display level. */
  step(peak: number, now: number): number {
    if (peak >= 0) {
      this.current = METER_OVER_DB;
      this.holdUntil = now + METER_OVER_HOLD_MS;
      this.afterOver = true;
      return this.current;
    }
    if (now < this.holdUntil) return this.current;
    const fallen = this.current - (this.afterOver ? METER_OVER_FALL_DB : METER_FALL_DB);
    if (peak >= fallen) {
      this.current = peak;
      this.afterOver = false;
    } else {
      this.current = Math.max(METER_FLOOR_DB, fallen);
    }
    return this.current;
  }
}

/** Sum of levels in dB as powers; −Infinity when there are none. */
function powerSum(levels: readonly number[]): number {
  let sum = 0;
  for (const db of levels) if (db > -Infinity) sum += 10 ** (db / 10);
  return sum > 0 ? 10 * Math.log10(sum) : -Infinity;
}

export type SignalMap = ReadonlyMap<string, Signal> | Readonly<Record<string, Signal>>;

const isMap = (s: SignalMap): s is ReadonlyMap<string, Signal> => s instanceof Map;

function signalEntries(signals: SignalMap): [string, Signal][] {
  return isMap(signals) ? [...signals.entries()] : Object.entries(signals);
}

interface SourcePeak {
  readonly source: RouteSource;
  readonly index: number;
  readonly peak: number;
}

const meterKey = (bus: MeterBus, n: number): string => `${bus}/${String(n)}`;

export interface MeterEngineOptions {
  /** Signals by meter key, e.g. `in/8` or `pb/0`; channels without one are silent. */
  readonly signals?: SignalMap;
  readonly random?: () => number;
}

/** Computes meter frames for the visible channels of a mixer. */
export class MeterEngine {
  private readonly mixer: SimMixer;
  private readonly random: () => number;
  private readonly signals = new Map<string, Signal>();
  private readonly meters = new Map<string, MeterBallistics>();
  /** Address → last value sent, as float32. */
  private readonly sent = new Map<string, number>();

  constructor(mixer: SimMixer, options: MeterEngineOptions = {}) {
    this.mixer = mixer;
    this.random = options.random ?? Math.random;
    if (options.signals) this.setSignals(options.signals);
  }

  /** Sets (or with undefined, clears) the signal of one channel, e.g. `in/8`. */
  setSignal(key: string, signal: Signal | undefined): void {
    if (signal) this.signals.set(key, signal);
    else this.signals.delete(key);
  }

  /** Replaces every signal. */
  setSignals(signals: SignalMap): void {
    this.signals.clear();
    for (const [key, signal] of signalEntries(signals)) this.signals.set(key, signal);
  }

  /** Current display level of a meter. */
  level(bus: MeterBus, n: number): number {
    return this.meters.get(meterKey(bus, n))?.level ?? METER_FLOOR_DB;
  }

  /** Advances one frame and returns the visible meters whose value changed since last sent. */
  frame(now: number): OscMessage[] {
    const peaks = this.sourcePeaks(now);
    for (const bus of BUS_ORDER) {
      for (const n of this.mixer.visibleChannels(METER_BUS[bus])) {
        const key = meterKey(bus, n);
        const own = this.signals.get(key);
        const peak =
          bus !== 'out' || own
            ? (peaks.get(key)?.peak ?? (own ? signalPeak(own, now, this.random) : -Infinity))
            : this.outputPeak(n, peaks);
        this.meter(key).step(peak, now);
      }
    }
    return this.messages(false);
  }

  /** Every visible meter at its current level: the complete frame TotalMix sends on start. */
  fullFrame(): OscMessage[] {
    return this.messages(true);
  }

  /** Forgets what was sent, so the next frame sends every meter that is not at the floor. */
  reset(): void {
    this.sent.clear();
  }

  private meter(key: string): MeterBallistics {
    let m = this.meters.get(key);
    if (!m) {
      m = new MeterBallistics();
      this.meters.set(key, m);
    }
    return m;
  }

  private messages(all: boolean): OscMessage[] {
    const out: OscMessage[] = [];
    for (const bus of BUS_ORDER) {
      for (const n of this.mixer.visibleChannels(METER_BUS[bus])) {
        const address = `/level/${bus}/${String(n)}`;
        const value = Math.fround(this.level(bus, n));
        if (!all && this.sent.get(address) === value) continue;
        // Never sent and at the floor: TotalMix's complete start frame covered it.
        if (!all && !this.sent.has(address) && value === METER_FLOOR_DB) continue;
        this.sent.set(address, value);
        out.push(message(address, float(value)));
      }
    }
    return out;
  }

  /** Peaks of every input and playback channel that has a signal, visible or not. */
  private sourcePeaks(now: number): Map<string, SourcePeak> {
    const peaks = new Map<string, SourcePeak>();
    for (const [key, signal] of this.signals) {
      const [bus, index] = key.split('/');
      if ((bus !== 'in' && bus !== 'pb') || index === undefined) continue;
      peaks.set(key, {
        source: bus,
        index: Number(index),
        peak: signalPeak(signal, now, this.random),
      });
    }
    return peaks;
  }

  private outputPeak(n: number, peaks: ReadonlyMap<string, SourcePeak>): number {
    const mixer = this.mixer;
    const outLeft = mixer.isRight('output', n) ? n - 1 : n;
    const outStereo = mixer.isRight('output', outLeft + 1);
    const outSide = n - outLeft;
    if (mixer.channelValue('output', outLeft, 'mute') === 1) return -Infinity;
    const volume = mixer.channelValue('output', outLeft, 'volume');
    if (typeof volume !== 'number' || volume <= OFF_DB) return -Infinity;

    const levels: number[] = [];
    for (const { source, index: c, peak } of peaks.values()) {
      const bus = METER_BUS[source];
      const left = mixer.isRight(bus, c) ? c - 1 : c;
      const sourceStereo = mixer.isRight(bus, left + 1);
      // A stereo source feeds its sides to the matching sides of a stereo output.
      if (sourceStereo && outStereo && c - left !== outSide) continue;
      if (mixer.channelValue(bus, left, 'mute') === 1) continue;
      const fader = mixer.routeValue(source, left, outLeft, 'fader');
      if (typeof fader !== 'number' || fader <= OFF_DB) continue;
      levels.push(peak + fader);
    }
    return powerSum(levels) + volume;
  }
}
