// Device profiles: what the protocol does not say about an interface. Labels of the physical
// channels, channel counts per sample rate, and preamp gain ranges.
//
// TotalMix itself tells us which channels exist (only visible ones are sent) and which have
// 48V, Inst, AutoSet or a reference level (those settings are only sent where the hardware has
// them), so the channel list and those switches always come from the device, not from here.
// An interface without a profile gets the generic one.

import type { Bus } from './targets.ts';

/** Sample-rate range: single (up to 48 kHz), double (88.2/96 kHz), quad (176.4/192 kHz). */
export type SpeedMode = 'single' | 'double' | 'quad';

export interface GainRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Lowest setting above `min` when the range has a gap (mic preamps jump from 0 to 8 dB). */
  readonly minAboveZero?: number;
}

export interface DeviceProfile {
  readonly id: string;
  /** Model name as the device reports it, without serial number. */
  readonly model: string;
  /** Physical channels on a bus, or undefined if unknown. */
  channelCount(bus: Bus, speed?: SpeedMode): number | undefined;
  /** Label of one physical channel, e.g. "AN 1", "Mic 9", "ADAT 3". */
  label(bus: Bus, index: number, speed?: SpeedMode): string;
  /** Label of a strip, e.g. "AN 1/2" for a stereo pair. */
  stripLabel(bus: Bus, index: number, stereo: boolean, speed?: SpeedMode): string;
  /** Preamp gain range of an input, or undefined if unknown. */
  inputGain(index: number, options?: { instrument?: boolean }): GainRange | undefined;
}

// --- rows -----------------------------------------------------------------------------

interface Row {
  readonly prefix: string;
  /** Number of the first channel in its label (UFX III: Mic 9-12, PH 9-12). */
  readonly first: number;
  readonly count: Readonly<Record<SpeedMode, number>>;
  /** Fixed labels instead of numbers (AES L, AES R). */
  readonly names?: readonly string[];
  /** Label of a stereo pair when `names` are used. */
  readonly pairName?: string;
}

const fixed = (n: number): Readonly<Record<SpeedMode, number>> => ({
  single: n,
  double: n,
  quad: n,
});

interface Position {
  readonly row: Row;
  /** 0-based position within the row. */
  readonly offset: number;
}

function locate(rows: readonly Row[], index: number, speed: SpeedMode): Position | undefined {
  let start = 0;
  for (const row of rows) {
    const n = row.count[speed];
    if (index < start + n) return { row, offset: index - start };
    start += n;
  }
  return undefined;
}

function rowLabel({ row, offset }: Position): string {
  return row.names?.[offset] ?? `${row.prefix} ${String(row.first + offset)}`;
}

const GENERIC_PREFIX: Readonly<Record<Bus, string>> = {
  input: 'In',
  playback: 'Play',
  output: 'Out',
};

function genericLabel(bus: Bus, index: number): string {
  return `${GENERIC_PREFIX[bus]} ${String(index + 1)}`;
}

function genericStripLabel(bus: Bus, index: number, stereo: boolean): string {
  return stereo
    ? `${GENERIC_PREFIX[bus]} ${String(index + 1)}/${String(index + 2)}`
    : genericLabel(bus, index);
}

function rowsProfile(spec: {
  readonly id: string;
  readonly model: string;
  readonly rows: Readonly<Record<Bus, readonly Row[]>>;
  readonly inputGain: DeviceProfile['inputGain'];
}): DeviceProfile {
  const count = (bus: Bus, speed: SpeedMode): number =>
    spec.rows[bus].reduce((n, row) => n + row.count[speed], 0);
  const label = (bus: Bus, index: number, speed: SpeedMode = 'single'): string => {
    const at = locate(spec.rows[bus], index, speed);
    return at ? rowLabel(at) : genericLabel(bus, index);
  };
  return {
    id: spec.id,
    model: spec.model,
    channelCount: (bus, speed = 'single') => count(bus, speed),
    label,
    stripLabel: (bus, index, stereo, speed = 'single') => {
      if (!stereo) return label(bus, index, speed);
      const left = locate(spec.rows[bus], index, speed);
      const right = locate(spec.rows[bus], index + 1, speed);
      if (!left || !right) return genericStripLabel(bus, index, true);
      if (left.row === right.row) {
        if (left.row.names) return left.row.pairName ?? `${rowLabel(left)}/${rowLabel(right)}`;
        return `${rowLabel(left)}/${String(left.row.first + right.offset)}`;
      }
      return `${rowLabel(left)}/${rowLabel(right)}`;
    },
    inputGain: spec.inputGain,
  };
}

// --- Fireface UFX III -------------------------------------------------------------------

// Channel rows as TotalMix shows them; ADAT and MADI shrink at higher sample rates
// (94 channels per bus up to 48 kHz, 54 at 96 kHz, 34 at 192 kHz).
const UFX3_DIGITAL: readonly Row[] = [
  { prefix: 'AES', first: 1, count: fixed(2), names: ['AES L', 'AES R'], pairName: 'AES' },
  { prefix: 'ADAT', first: 1, count: { single: 16, double: 8, quad: 4 } },
  { prefix: 'MADI', first: 1, count: { single: 64, double: 32, quad: 16 } },
];
const UFX3_OUTPUT_ROWS: readonly Row[] = [
  { prefix: 'AN', first: 1, count: fixed(8) },
  { prefix: 'PH', first: 9, count: fixed(4) },
  ...UFX3_DIGITAL,
];

/** Mic/Inst 9-12: 0 dB, then 8 to 75 dB in 1 dB steps; Inst (TRS) 8 to 50 dB. */
const UFX3_MIC_GAIN: GainRange = { min: 0, max: 75, step: 1, minAboveZero: 8 };
const UFX3_INST_GAIN: GainRange = { min: 8, max: 50, step: 1 };
/** Line 1-8: 0 to 12 dB. The step is inferred from 6.5 dB seen in the capture. */
const UFX3_LINE_GAIN: GainRange = { min: 0, max: 12, step: 0.5 };

export const FIREFACE_UFX_III: DeviceProfile = rowsProfile({
  id: 'fireface-ufx-iii',
  model: 'Fireface UFX III',
  rows: {
    input: [
      { prefix: 'AN', first: 1, count: fixed(8) },
      { prefix: 'Mic', first: 9, count: fixed(4) },
      ...UFX3_DIGITAL,
    ],
    playback: UFX3_OUTPUT_ROWS,
    output: UFX3_OUTPUT_ROWS,
  },
  inputGain: (index, options = {}) => {
    if (index >= 0 && index < 8) return UFX3_LINE_GAIN;
    if (index >= 8 && index < 12)
      return options.instrument === true ? UFX3_INST_GAIN : UFX3_MIC_GAIN;
    return undefined;
  },
});

// --- generic ----------------------------------------------------------------------------

/** Profile for an interface we know nothing about: numbered labels, no ranges. */
export function genericProfile(model: string): DeviceProfile {
  return {
    id: 'generic',
    model,
    channelCount: () => undefined,
    label: genericLabel,
    stripLabel: genericStripLabel,
    inputGain: () => undefined,
  };
}

const PROFILES: readonly DeviceProfile[] = [FIREFACE_UFX_III];

/** Profile for the model name reported by the device (serial number already removed). */
export function detectProfile(model: string | undefined): DeviceProfile {
  const wanted = (model ?? '').trim().toLowerCase();
  return PROFILES.find((p) => p.model.toLowerCase() === wanted) ?? genericProfile(model ?? '');
}
