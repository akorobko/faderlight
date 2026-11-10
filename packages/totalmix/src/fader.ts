// TotalMix fader law: fader position (0 to 1) against gain in dB.
//
// The curve is the one documented for TotalMix's linear fader values
// (docs/design/01-capabilities.md §3.2): quadratic below -6 dB, linear above, with 1023 steps.
// It agrees with the capture where the capture can check it: the lowest value above off is
// -65 dB (position 0 here) and the top is +6 dB. Linear fader values ("Send faders in linear
// scale") were off in the capture, so the adaptor uses it for display and stepping, never on
// the wire.

/** Gain at the bottom of the fader travel, the lowest value above off. */
export const FADER_MIN_DB = -65;
/** Gain at the top of the fader travel. */
export const FADER_MAX_DB = 6;
/** Steps over the whole travel. */
export const FADER_STEPS = 1023;

const KNEE = 649; // step where the curve turns linear (-6 dB)

/** Gain in dB at a fader position. Position 0 or less is off (-Infinity). */
export function dbAtPosition(position: number): number {
  if (Number.isNaN(position)) throw new RangeError('fader position is NaN');
  if (position <= 0) return -Infinity;
  const f = Math.min(1, position) * FADER_STEPS;
  return f >= KNEE
    ? f * 0.0320855615 - 26.8235294118
    : -(f * f) / 11033 + f * 0.1497326203 + FADER_MIN_DB;
}

/** Fader position (0 to 1) for a gain in dB. Off and anything at or below -65 dB give 0. */
export function positionAtDb(db: number): number {
  if (Number.isNaN(db)) throw new RangeError('gain is NaN');
  if (db <= FADER_MIN_DB) return 0;
  if (db >= FADER_MAX_DB) return 1;
  const f = db >= -6 ? (db + 26.8235294118) / 0.0320855615 : 826 - Math.sqrt(-34869 - 11033 * db);
  return Math.min(1, Math.max(0, f / FADER_STEPS));
}

/**
 * Moves a gain by whole fader steps (positive is louder), as a ± key or encoder would.
 * From off, the first step up lands on the lowest audible position; stepping below it gives off.
 */
export function stepDb(db: number, steps: number, stepSize = 1 / FADER_STEPS): number {
  const from = db === -Infinity ? 0 : positionAtDb(db);
  const to = Math.min(1, Math.max(0, from + steps * stepSize));
  if (to <= 0) return -Infinity;
  return Math.round(dbAtPosition(to) * 100) / 100;
}
