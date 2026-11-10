// What the Control Center pages show about the mixer, worked out here from the store so the
// page needs no mixer logic of its own: the device, the strips TotalMix shows on each bus with
// their names, labels and colour numbers, which outputs are Main and the Phones, and the
// snapshots. Meters go separately (meterFrame), many times a second.

import {
  BUSES,
  channelValue,
  deviceModel,
  mainOutput,
  phonesOutput,
  strips,
  type Bus,
  type ConnectionState,
  type MixerStore,
  type SnapshotState,
} from '@faderlight/model';

export interface StripInfo {
  readonly bus: Bus;
  readonly index: number;
  readonly right?: number | undefined;
  readonly stereo: boolean;
  /** Name in TotalMix. */
  readonly name: string;
  /** Physical label, e.g. "AN 1/2". */
  readonly label: string;
  /** TotalMix colour number, if reported. */
  readonly color?: number | undefined;
  readonly muted: boolean;
}

export interface SnapshotInfo {
  readonly n: number;
  readonly state?: SnapshotState | undefined;
  /** The name in TotalMix's state file, if found. */
  readonly mixerName?: string | undefined;
}

export interface MixerSummary {
  readonly link: ConnectionState;
  readonly synced: boolean;
  readonly device?: string | undefined;
  readonly strips: Readonly<Record<Bus, readonly StripInfo[]>>;
  /** Output index of Main and of Phones 1-4 (undefined: none). */
  readonly main?: number | undefined;
  readonly phones: readonly (number | undefined)[];
  readonly snapshots: readonly SnapshotInfo[];
}

export function mixerSummary(
  store: MixerStore,
  snapshotNames: readonly (string | undefined)[] = [],
): MixerSummary {
  const byBus = (bus: Bus): StripInfo[] =>
    strips(store, bus).map((s) => {
      const color = channelValue(store, bus, s.index, 'color');
      return {
        bus,
        index: s.index,
        right: s.right,
        stereo: s.stereo,
        name: s.name,
        label: s.label,
        color: typeof color === 'number' ? color : undefined,
        muted: channelValue(store, bus, s.index, 'mute') === true,
      };
    });
  return {
    link: store.connection,
    synced: store.synced,
    device: deviceModel(store),
    strips: Object.fromEntries(BUSES.map((b) => [b, byBus(b)])) as Record<Bus, StripInfo[]>,
    main: mainOutput(store)?.index,
    phones: ([1, 2, 3, 4] as const).map((n) => phonesOutput(store, n)?.index),
    snapshots: Array.from({ length: 8 }, (_, i) => ({
      n: i + 1,
      state: store.value({ scope: 'snapshot', n: i + 1 }) as SnapshotState | undefined,
      mixerName: snapshotNames[i],
    })),
  };
}

/** Level, peak and clip (1/0) of a meter, rounded to tenths of a dB. */
export type MeterTuple = readonly [level: number, peak: number, clip: 0 | 1];

/** Every visible channel's meter now, by "bus/index" (both sides of a stereo strip). */
export function meterFrame(store: MixerStore, now: number): Record<string, MeterTuple> {
  const out: Record<string, MeterTuple> = {};
  const round = (db: number): number => Math.round(db * 10) / 10;
  for (const bus of BUSES) {
    for (const s of strips(store, bus)) {
      for (const index of s.right === undefined ? [s.index] : [s.index, s.right]) {
        const m = store.meters.read(bus, index, now);
        out[`${bus}/${String(index)}`] = [round(m.level), round(m.peak), m.clip ? 1 : 0];
      }
    }
  }
  return out;
}
