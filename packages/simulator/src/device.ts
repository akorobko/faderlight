// The simulated interface: channel counts and labels come from the model's device profile; which
// channels have a preamp, 48V or a reference level is hardware knowledge the profile leaves to
// the device (TotalMix only sends those settings where the hardware has them).

import {
  FIREFACE_UFX_III,
  type Bus,
  type DeviceProfile,
  type GainRange,
  type SpeedMode,
} from '@faderlight/model';
import type { Feature } from './fields.ts';

export interface SimDevice {
  readonly profile: DeviceProfile;
  /** What `/status/device` reports: model and serial, like "Fireface UFX III (12345678)". */
  readonly status: string;
  /** Physical channels on a bus at a sample-rate range. */
  channelCount(bus: Bus, speed: SpeedMode): number;
  /** Hardware features of one physical channel. */
  features(bus: Bus, index: number): ReadonlySet<Feature>;
  /** Preamp or trim range of an input, used to clamp gain writes (inferred), or undefined. */
  inputGain(index: number, instrument: boolean): GainRange | undefined;
}

const NONE: ReadonlySet<Feature> = new Set();
const LINE: ReadonlySet<Feature> = new Set(['gain', 'refLevel']);
const MIC: ReadonlySet<Feature> = new Set(['gain', 'mic']);
const ANALOG_OUT: ReadonlySet<Feature> = new Set(['refLevel']);

/**
 * Fireface UFX III. In the capture, the visible line inputs (AN 3-6) had gain and a reference
 * level, the mic inputs (Mic 9-12) gain, 48V, Inst and AutoSet, and the digital inputs (ADAT)
 * neither; this assumes the same for all of AN 1-8 and every digital input. The visible analog
 * and phones outputs had a reference level, the digital ones did not. Every output had gain.
 */
export function firefaceUfxIII(serial = '00000000'): SimDevice {
  const profile = FIREFACE_UFX_III;
  return {
    profile,
    status: `${profile.model} (${serial})`,
    channelCount: (bus, speed) => profile.channelCount(bus, speed) ?? 0,
    features: (bus, index) => {
      if (bus === 'input') return index < 8 ? LINE : index < 12 ? MIC : NONE;
      if (bus === 'output') return index < 12 ? ANALOG_OUT : NONE;
      return NONE;
    },
    inputGain: (index, instrument) => profile.inputGain(index, { instrument }),
  };
}

/** Clamps a gain write to the range and step of the preamp (inferred: not captured). */
export function snapGain(range: GainRange | undefined, db: number): number {
  if (!range) return db;
  let v = Math.min(range.max, Math.max(range.min, db));
  if (range.minAboveZero !== undefined && v > range.min && v < range.minAboveZero) {
    v = range.minAboveZero;
  }
  return Math.round(v / range.step) * range.step;
}
