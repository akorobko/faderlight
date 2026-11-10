// Number formatting for keys. Minus is U+2212, an unknown value is two en dashes
// (docs/design/03-ux.md §2.1), off is −∞.

export const MINUS = '−';
export const UNKNOWN = '––';
export const OFF = `${MINUS}∞`;

/** Lowest level shown as a number; anything below reads as off. */
export const OFF_BELOW_DB = -144;

function signed(value: number, digits: number): string {
  const s = Math.abs(value).toFixed(digits);
  if (Number(s) === 0) return (0).toFixed(digits);
  return (value < 0 ? MINUS : '+') + s;
}

/** A fader, send or output level in dB: "−18.5", "0.0", "+6.0", "−∞". */
export function formatLevel(db: number | undefined): string {
  if (db === undefined || Number.isNaN(db)) return UNKNOWN;
  if (db === -Infinity || db < OFF_BELOW_DB) return OFF;
  return signed(db, 1);
}

/** Preamp gain in dB: "+42", "+6.5", "0". Whole numbers without a decimal. */
export function formatGain(db: number | undefined): string {
  if (db === undefined || !Number.isFinite(db)) return UNKNOWN;
  const rounded = Math.round(db * 2) / 2;
  if (rounded === 0) return '0';
  return signed(rounded, Number.isInteger(rounded) ? 0 : 1);
}

/** A meter peak in dBFS: "−1.2", "−∞" below the floor, "OVER" at or above 0. */
export function formatPeak(db: number | undefined, floorDb: number): string {
  if (db === undefined || Number.isNaN(db)) return UNKNOWN;
  if (db <= floorDb) return OFF;
  if (db >= 0) return 'OVER';
  return signed(db, 1);
}

/** Elapsed time: "4:05", "12:34", "1:02:03". */
export function formatTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
    return `${UNKNOWN}:${UNKNOWN}`;
  const t = Math.floor(seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${s}` : `${String(m)}:${s}`;
}

/** Sample rate in kHz: 48000 -> "48 kHz", 44100 -> "44.1 kHz". */
export function formatRate(hz: number | undefined): string {
  if (hz === undefined || !Number.isFinite(hz) || hz <= 0) return `${UNKNOWN} kHz`;
  const k = Math.round(hz / 100) / 10;
  return `${Number.isInteger(k) ? String(k) : k.toFixed(1)} kHz`;
}
