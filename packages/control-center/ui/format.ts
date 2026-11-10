// Text for times and values on the pages.

const two = (n: number): string => String(n).padStart(2, '0');

/** 14:03:07.120 */
export function clockTime(at: number): string {
  const d = new Date(at);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/** "just now", "3 s ago", "2 min ago". */
export function formatAgo(ms: number): string {
  if (ms < 1000) return 'just now';
  if (ms < 60_000) return `${String(Math.round(ms / 1000))} s ago`;
  return `${String(Math.round(ms / 60_000))} min ago`;
}

/** A store value: −∞ for off, booleans as on/off. */
export function formatValue(v: unknown): string {
  if (v === -Infinity) return '−∞';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

/** −18.5 dB, +6.0 dB, −∞ */
export function formatDb(db: number): string {
  if (db === -Infinity) return '−∞';
  const s = db.toFixed(1);
  return db > 0 ? `+${s}` : s.replace('-', '−');
}
