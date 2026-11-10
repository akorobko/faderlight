// Removes identifiers from a capture before it leaves this computer: the interface's serial
// number (TotalMix reports it in /status/device, for example "Fireface UFX III (12345678)"),
// this computer's host name, user name and home folder, and any extra text passed with --mask.
// Every occurrence is replaced by the same number of "X", in the decoded messages and in the
// raw datagram bytes alike, so OSC string lengths and padding stay exactly as recorded.

import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { slug, uniquePath } from './paths.ts';

export interface Secret {
  readonly text: string;
  /** What it is, for the report: "serial number", "host name", ... */
  readonly kind: string;
}

export interface RedactResult {
  /** The redacted file (the input is replaced; its name loses the serial number). */
  readonly path: string;
  /** Occurrences replaced, per secret. */
  readonly replaced: readonly { readonly secret: Secret; readonly count: number }[];
}

/** Shorter text could match ordinary words or numbers, so it is never masked automatically. */
const MIN_LENGTH = 4;

const SERIAL_SUFFIX = /\s*\(([^()\s]+)\)\s*$/;

/** The serial number in a TotalMix device name, e.g. "Fireface UFX III (12345678)". */
export function serialOf(device: string): string | undefined {
  const s = SERIAL_SUFFIX.exec(device)?.[1];
  // Already masked ("XXXXXXXX") counts as none, so redacting twice changes nothing.
  return s !== undefined && s.length >= MIN_LENGTH && !/^X+$/.test(s) ? s : undefined;
}

/** The device name without its serial number, e.g. "Fireface UFX III". */
export function deviceLabel(device: string): string {
  const s = SERIAL_SUFFIX.exec(device)?.[1];
  return s !== undefined && s.length >= MIN_LENGTH ? device.replace(SERIAL_SUFFIX, '') : device;
}

/** Identifiers of this computer that should not end up in a shared file. */
export function localSecrets(): Secret[] {
  const out: Secret[] = [];
  const host = hostname();
  out.push({ text: host, kind: 'host name' });
  const short = host.split('.')[0];
  if (short !== undefined && short !== host) out.push({ text: short, kind: 'host name' });
  try {
    out.push({ text: userInfo().username, kind: 'user name' });
  } catch {
    // No user name (some containers); nothing to mask.
  }
  const home = homedir();
  if (home !== '/' && home !== '') out.push({ text: home, kind: 'home folder' });
  return out;
}

/** Drops secrets that are too short, duplicated, or contained in a longer one. */
export function normaliseSecrets(secrets: readonly Secret[]): Secret[] {
  const seen = new Set<string>();
  const kept = secrets
    .filter((s) => s.text.trim().length >= MIN_LENGTH)
    .filter((s) => {
      const key = s.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    // Longest first, so "/Users/name" is masked whole before "name" is.
    .sort((a, b) => b.text.length - a.text.length);
  return kept;
}

const lower = (b: number): number => (b >= 0x41 && b <= 0x5a ? b + 0x20 : b);

/** Replaces each UTF-8 occurrence of `needle` (ASCII letters case-insensitive) in place. */
export function maskBytes(bytes: Uint8Array, needle: string): number {
  const n = [...Buffer.from(needle, 'utf8')].map(lower);
  let count = 0;
  outer: for (let i = 0; i + n.length <= bytes.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (lower(bytes[i + j] ?? 0) !== n[j]) continue outer;
    }
    bytes.fill(0x58, i, i + n.length); // "X"
    count++;
    i += n.length - 1;
  }
  return count;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function maskString(s: string, needle: string, counter: { n: number }): string {
  return s.replace(new RegExp(escape(needle), 'gi'), (m) => {
    counter.n++;
    // One X per UTF-8 byte, so the decoded text still matches the masked raw bytes.
    return 'X'.repeat(Buffer.byteLength(m, 'utf8'));
  });
}

function maskBase64(b64: string, needle: string, counter: { n: number }): string {
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  const found = maskBytes(bytes, needle);
  if (found === 0) return b64;
  counter.n += found;
  return Buffer.from(bytes).toString('base64');
}

/** Masks `needle` everywhere in a parsed record: strings, object keys, raw bytes and blobs. */
function maskValue(value: unknown, needle: string, counter: { n: number }, key?: string): unknown {
  if (typeof value === 'string') {
    return key === 'raw' ? maskBase64(value, needle, counter) : maskString(value, needle, counter);
  }
  if (Array.isArray(value)) {
    // An OSC blob argument: ["b", "<base64>"].
    if (value.length === 2 && value[0] === 'b' && typeof value[1] === 'string') {
      return ['b', maskBase64(value[1], needle, counter)];
    }
    return value.map((v) => maskValue(v, needle, counter));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[maskString(k, needle, counter)] = maskValue(v, needle, counter, k);
    }
    return out;
  }
  return value;
}

function parseLines(text: string, file: string): unknown[] {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((line, i) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (err) {
        throw new Error(`${file}:${String(i + 1)}: not JSON (${String(err)})`, { cause: err });
      }
    });
}

/** Serial numbers in the device names a capture contains (rx messages and the end record). */
export function serialsIn(records: readonly unknown[]): Secret[] {
  const found = new Set<string>();
  const consider = (device: unknown): void => {
    if (typeof device !== 'string') return;
    const s = serialOf(device);
    if (s !== undefined) found.add(s);
  };
  for (const r of records) {
    if (r === null || typeof r !== 'object') continue;
    const rec = r as { k?: unknown; device?: unknown; msgs?: unknown };
    if (rec.k === 'end' || rec.k === 'meta') consider(rec.device);
    if (!Array.isArray(rec.msgs)) continue;
    for (const m of rec.msgs as { a?: unknown; args?: unknown }[]) {
      if (m.a !== '/status/device' || !Array.isArray(m.args)) continue;
      for (const arg of m.args as unknown[]) {
        if (Array.isArray(arg) && arg[0] === 's') consider(arg[1]);
      }
    }
  }
  return [...found].map((text) => ({ text, kind: 'serial number' }));
}

/** Masks the secrets in the given records; returns the new records and the counts. */
export function redactRecords(
  records: readonly unknown[],
  secrets: readonly Secret[],
): { records: unknown[]; replaced: { secret: Secret; count: number }[] } {
  let out = [...records];
  const replaced: { secret: Secret; count: number }[] = [];
  for (const secret of normaliseSecrets(secrets)) {
    const counter = { n: 0 };
    out = out.map((r) => maskValue(r, secret.text, counter));
    replaced.push({ secret, count: counter.n });
  }
  return { records: out, replaced };
}

/**
 * True when the secret still appears in a string, a key, a raw datagram or a blob. (The base64
 * text itself is not searched: a short secret can occur in it by chance without meaning.)
 */
function stillContains(records: readonly unknown[], s: string): boolean {
  const probe = { n: 0 };
  for (const r of records) maskValue(r, s, probe);
  return probe.n > 0;
}

/** File name without the secrets, e.g. fireface-ufx-iii-12345678-2.1-... -> fireface-ufx-iii-2.1-... */
export function redactedName(name: string, secrets: readonly Secret[]): string {
  let out = name;
  for (const s of normaliseSecrets(secrets)) {
    const part = escape(slug(s.text));
    out = out.replace(new RegExp(`-${part}(?=-|\\.jsonl$)`, 'gi'), '');
    out = out.replace(new RegExp(part, 'gi'), (m) => 'X'.repeat(m.length));
  }
  return out;
}

/**
 * Redacts a capture file in place: the serial numbers it contains, the given secrets (this
 * computer's identifiers and --mask text). Writes the result, checks nothing is left, then
 * replaces the input (renamed when its name contained a secret).
 */
export function redactFile(file: string, extra: readonly Secret[]): RedactResult {
  const text = readFileSync(file, 'utf8');
  const records = parseLines(text, file);
  const secrets = normaliseSecrets([...serialsIn(records), ...extra]);
  const { records: redacted, replaced } = redactRecords(records, secrets);
  const lines = redacted.map((r) => JSON.stringify(r));
  for (const s of secrets) {
    if (stillContains(redacted, s.text))
      throw new Error(`could not remove the ${s.kind} "${s.text}" from ${file}; nothing changed`);
  }
  const dir = dirname(file);
  const name = redactedName(basename(file), secrets);
  const tmp = join(dir, `.redact-${String(process.pid)}.partial.jsonl`);
  writeFileSync(tmp, lines.map((l) => l + '\n').join(''), { flag: 'w' });
  const target = name === basename(file) ? file : uniquePath(dir, name);
  renameSync(tmp, target);
  if (target !== file) unlinkSync(file);
  return { path: target, replaced };
}
