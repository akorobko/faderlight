// Typed views of the store for controllers and renderers.

import { detectProfile, type DeviceProfile, type SpeedMode } from './profiles.ts';
import type { MixerStore } from './store.ts';
import {
  NO_CHANNEL,
  type Bus,
  type ChannelField,
  type SnapshotState,
  type SourceBus,
  type Value,
} from './targets.ts';

export interface Strip {
  readonly bus: Bus;
  /** Left (or only) physical channel. */
  readonly index: number;
  /** Right physical channel of a stereo strip. */
  readonly right: number | undefined;
  readonly stereo: boolean;
  /** Name as set in the mixer. */
  readonly name: string;
  /** Physical label from the device profile, e.g. "AN 1/2". */
  readonly label: string;
}

export function channelValue(
  store: MixerStore,
  bus: Bus,
  index: number,
  field: ChannelField,
): Value | undefined {
  return store.value({ scope: 'channel', bus, index, field });
}

/** The device model without serial number, once reported. */
export function deviceModel(store: MixerStore): string | undefined {
  const v = store.value({ scope: 'status', field: 'device' });
  return typeof v === 'string' ? v : undefined;
}

export function deviceProfile(store: MixerStore): DeviceProfile {
  return detectProfile(deviceModel(store));
}

/**
 * The strips of a bus, in index order. A strip exists once the device reported its name: only
 * channels visible in TotalMix are sent, so this is the channel list to show.
 */
export function strips(store: MixerStore, bus: Bus, speed: SpeedMode = 'single'): Strip[] {
  const profile = deviceProfile(store);
  const out: Strip[] = [];
  for (const e of store.entries()) {
    const t = e.target;
    if (t.scope !== 'channel' || t.bus !== bus || t.field !== 'name') continue;
    const stereo = channelValue(store, bus, t.index, 'stereo') === true;
    out.push({
      bus,
      index: t.index,
      right: stereo ? t.index + 1 : undefined,
      stereo,
      name: typeof e.value === 'string' ? e.value : '',
      label: profile.stripLabel(bus, t.index, stereo, speed),
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The strip a physical channel belongs to (a right channel belongs to its left neighbour). */
export function stripOf(store: MixerStore, bus: Bus, index: number): Strip | undefined {
  return strips(store, bus).find((s) => s.index === index || s.right === index);
}

function outputStrip(store: MixerStore, field: 'mainOut' | 'mainOutB' | `phones${1 | 2 | 3 | 4}`) {
  const index = store.value({ scope: 'controlRoom', field });
  if (typeof index !== 'number' || index === NO_CHANNEL) return undefined;
  return stripOf(store, 'output', index);
}

/** The output TotalMix uses as Main (`/controlroom/mainout`), not a fixed channel. */
export function mainOutput(store: MixerStore): Strip | undefined {
  return outputStrip(store, 'mainOut');
}

/** The output assigned to Phones 1-4, if any. */
export function phonesOutput(store: MixerStore, n: 1 | 2 | 3 | 4): Strip | undefined {
  return outputStrip(store, PHONES[n]);
}

const PHONES = { 1: 'phones1', 2: 'phones2', 3: 'phones3', 4: 'phones4' } as const;

/** The loaded snapshot (1-8) and whether it changed since loading, or undefined. */
export function activeSnapshot(
  store: MixerStore,
): { readonly n: number; readonly modified: boolean } | undefined {
  for (let n = 1; n <= 8; n++) {
    const state = store.value({ scope: 'snapshot', n }) as SnapshotState | undefined;
    if (state === 'active' || state === 'modified') return { n, modified: state === 'modified' };
  }
  return undefined;
}

/**
 * Send level of a route in dB. After a full sync a route the device did not report is off
 * (TotalMix leaves routes that are off out of `/sendall 2`); before one it is unknown.
 */
export function routeLevel(
  store: MixerStore,
  source: SourceBus,
  index: number,
  output: number,
): number | undefined {
  const v = store.value({ scope: 'route', source, index, output, field: 'fader' });
  if (typeof v === 'number') return v;
  return store.synced ? -Infinity : undefined;
}
