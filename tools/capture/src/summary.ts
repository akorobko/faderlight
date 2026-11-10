// Summarises a capture file: per-step results and every address pattern with its argument
// types, index ranges and example values. Used by people (`capture summary <file>`) and by
// agents writing docs/protocol/global-osc.md (`--json`).

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { JsonArg } from './osc.ts';
import type {
  CaptureRecord,
  EndRecord,
  JsonMessage,
  MetaRecord,
  NoteRecord,
  StepStats,
} from './records.ts';

export interface StepSummary {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly why: string | undefined;
  readonly sends: readonly string[];
  result: string;
  stats: StepStats | undefined;
  detail: Readonly<Record<string, unknown>> | undefined;
  readonly addresses: Set<string>;
}

export interface PatternSummary {
  /** Address with numeric path segments replaced by {n}. */
  readonly pattern: string;
  /** Messages seen in rx records. */
  count: number;
  /** Times seen in thinned meter snapshots (tick records). */
  snapshots: number;
  readonly addresses: Set<string>;
  /** Type tag signatures, e.g. "f", "s", "ff". */
  readonly types: Set<string>;
  /** Min/max of each {n} segment, in order. */
  readonly ranges: [number, number][];
  /** Up to 5 distinct example values. */
  readonly examples: string[];
  /** Steps the pattern was received in (in order of first appearance). */
  readonly steps: string[];
}

export interface Summary {
  meta: MetaRecord | undefined;
  end: EndRecord | undefined;
  readonly steps: StepSummary[];
  readonly patterns: Map<string, PatternSummary>;
  readonly notes: NoteRecord[];
  readonly tx: { count: number };
  readonly rx: {
    datagrams: number;
    messages: number;
    bytes: number;
    bundles: number;
    errors: number;
  };
  readonly rates: { ticks: number; maxMsgPerSec: number; maxBytesPerSec: number; seconds: number };
  readonly sources: Set<string>;
  fileBytes: number | undefined;
}

export function patternOf(address: string): { pattern: string; indices: number[] } {
  const indices: number[] = [];
  const pattern = address
    .split('/')
    .map((seg) => {
      if (/^-?\d+$/.test(seg)) {
        indices.push(Number(seg));
        return '{n}';
      }
      return seg;
    })
    .join('/');
  return { pattern, indices };
}

const showValue = (args: readonly JsonArg[]): string =>
  args
    .map((a) =>
      a.length === 1 ? a[0] : typeof a[1] === 'string' ? JSON.stringify(a[1]) : String(a[1]),
    )
    .join(' ') || '(none)';

export class Summariser {
  readonly summary: Summary = {
    meta: undefined,
    end: undefined,
    steps: [],
    patterns: new Map(),
    notes: [],
    tx: { count: 0 },
    rx: { datagrams: 0, messages: 0, bytes: 0, bundles: 0, errors: 0 },
    rates: { ticks: 0, maxMsgPerSec: 0, maxBytesPerSec: 0, seconds: 0 },
    sources: new Set(),
    fileBytes: undefined,
  };

  private current: StepSummary | undefined;

  add(record: CaptureRecord): void {
    const s = this.summary;
    switch (record.k) {
      case 'meta':
        s.meta = record;
        break;
      case 'end':
        s.end = record;
        break;
      case 'note':
        s.notes.push(record);
        break;
      case 'tx':
        s.tx.count += record.msgs.length;
        break;
      case 'step':
        if (record.phase === 'begin') {
          this.current = {
            id: record.id,
            kind: record.kind ?? '',
            title: record.title ?? '',
            why: record.why,
            sends: record.sends ?? [],
            result: '(not finished)',
            stats: undefined,
            detail: undefined,
            addresses: new Set(),
          };
          s.steps.push(this.current);
        } else {
          const step =
            this.current?.id === record.id ? this.current : s.steps.find((x) => x.id === record.id);
          if (step) {
            step.result = record.result ?? '';
            step.stats = record.stats;
            step.detail = record.detail;
          }
          this.current = undefined;
        }
        break;
      case 'rx':
        s.rx.datagrams++;
        s.rx.bytes += record.size;
        s.sources.add(record.from);
        if (record.tt !== undefined) s.rx.bundles++;
        if (record.error !== undefined) s.rx.errors++;
        for (const m of record.msgs ?? []) this.addMessage(m, 'rx');
        break;
      case 'tick': {
        const sec = record.ms / 1000;
        if (sec > 0.2) {
          s.rates.ticks++;
          s.rates.seconds += sec;
          s.rates.maxMsgPerSec = Math.max(s.rates.maxMsgPerSec, record.rx.messages / sec);
          s.rates.maxBytesPerSec = Math.max(s.rates.maxBytesPerSec, record.rx.bytes / sec);
        }
        for (const [a, args] of Object.entries(record.levels ?? {})) {
          this.addMessage({ a, args }, 'tick');
        }
        break;
      }
    }
  }

  private addMessage(m: JsonMessage, source: 'rx' | 'tick'): void {
    const s = this.summary;
    if (source === 'rx') s.rx.messages++;
    const { pattern, indices } = patternOf(m.a);
    let p = s.patterns.get(pattern);
    if (!p) {
      p = {
        pattern,
        count: 0,
        snapshots: 0,
        addresses: new Set(),
        types: new Set(),
        ranges: indices.map((n) => [n, n]),
        examples: [],
        steps: [],
      };
      s.patterns.set(pattern, p);
    }
    if (source === 'rx') p.count++;
    else p.snapshots++;
    p.addresses.add(m.a);
    p.types.add(m.args.map((a) => a[0]).join('') || '(none)');
    indices.forEach((n, k) => {
      const r = p.ranges[k];
      if (r) {
        r[0] = Math.min(r[0], n);
        r[1] = Math.max(r[1], n);
      }
    });
    if (p.examples.length < 5) {
      const v = showValue(m.args);
      if (!p.examples.includes(v)) p.examples.push(v);
    }
    const stepId = this.current?.id ?? '(between steps)';
    if (!p.steps.includes(stepId)) p.steps.push(stepId);
    this.current?.addresses.add(m.a);
  }
}

export async function summariseFile(path: string): Promise<Summary> {
  const summariser = new Summariser();
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let line = 0;
  for await (const text of rl) {
    line++;
    if (text.trim() === '') continue;
    try {
      summariser.add(JSON.parse(text) as CaptureRecord);
    } catch (err) {
      throw new Error(`${path}:${String(line)}: not a capture record (${String(err)})`, {
        cause: err,
      });
    }
  }
  summariser.summary.fileBytes = (await stat(path)).size;
  return summariser.summary;
}

// --- output ---------------------------------------------------------------------------

const mb = (n: number): string => `${(n / 1e6).toFixed(1)} MB`;

function table(rows: readonly (readonly string[])[], maxWidths: readonly number[]): string[] {
  const widths = maxWidths.map((max, c) =>
    Math.min(max, Math.max(...rows.map((r) => (r[c] ?? '').length))),
  );
  return rows.map((r) =>
    r
      .map((cell, c) => {
        const w = widths[c] ?? 10;
        const t = cell.length > w ? cell.slice(0, Math.max(0, w - 1)) + '…' : cell;
        return c === r.length - 1 ? t : t.padEnd(w);
      })
      .join('  ')
      .trimEnd(),
  );
}

export function formatSummary(s: Summary, name: string): string[] {
  const out: string[] = [];
  const m = s.meta;
  out.push(`Capture ${name}${s.fileBytes === undefined ? '' : ` (${mb(s.fileBytes)})`}`);
  if (m) {
    out.push(
      `  ${m.startedAt}, ${m.command}${m.script === undefined ? '' : ` ${m.script}`}, TotalMix FX ${m.tmfxVersion}, ` +
        `node ${m.node} on ${m.platform} ${m.arch}`,
    );
    out.push(
      `  sent to ${m.host}:${String(m.sendPort)}, listened on ${m.bindAddress}:${String(m.listenPort)}, meters ${m.meters}`,
    );
    if (m.userNote !== '') out.push(`  note: ${m.userNote}`);
  }
  out.push(
    `  received ${String(s.rx.datagrams)} datagrams written (${String(s.rx.bundles)} bundles, ` +
      `${String(s.rx.errors)} undecodable), ${String(s.rx.messages)} messages; sent ${String(s.tx.count)}; ` +
      `from ${[...s.sources].join(', ') || 'nobody'}`,
  );
  if (s.end) {
    const t = s.end.totals;
    out.push(
      `  end: ${s.end.reason}; device ${s.end.device ?? 'unknown'}; all traffic ${String(t.rxDatagrams)} datagrams / ` +
        `${String(t.rxMessages)} messages / ${mb(t.rxBytes)}; meter datagrams thinned ${String(t.meterThinned)}, ` +
        `dropped over size cap ${String(t.meterDroppedOverCap)}`,
    );
    for (const u of s.end.unconfirmedRestores ?? []) out.push(`  UNCONFIRMED RESTORE: ${u}`);
  }
  if (s.rates.ticks > 0) {
    out.push(
      `  peak rate ${String(Math.round(s.rates.maxMsgPerSec))} msg/s, ${(s.rates.maxBytesPerSec / 1000).toFixed(1)} kB/s`,
    );
  }
  for (const n of s.notes.filter((x) => x.level === 'warn')) out.push(`  warning: ${n.text}`);

  out.push('', 'Steps');
  out.push(
    ...table(
      [
        ['id', 'result', 'msgs', 'addrs', 'first', 'time'],
        ...s.steps.map((st) => [
          st.id,
          st.result,
          String((st.stats?.rxMessages ?? 0) - (st.stats?.meterMessages ?? 0)),
          String(st.stats?.addresses ?? 0),
          st.stats?.firstRxMs == null ? '-' : `${String(Math.round(st.stats.firstRxMs))} ms`,
          st.stats ? `${(st.stats.ms / 1000).toFixed(1)} s` : '-',
        ]),
      ],
      [22, 60, 7, 6, 9, 8],
    ).map((l) => '  ' + l),
  );

  const patterns = [...s.patterns.values()].sort((a, b) => a.pattern.localeCompare(b.pattern));
  out.push('', `Address patterns (${String(patterns.length)})`);
  out.push(
    ...table(
      [
        ['pattern', 'count', 'addrs', 'types', 'indices', 'examples', 'steps'],
        ...patterns.map((p) => [
          p.pattern,
          p.snapshots > 0 && p.count === 0 ? `${String(p.snapshots)}t` : String(p.count),
          String(p.addresses.size),
          [...p.types].join(','),
          p.ranges.map(([a, b]) => (a === b ? String(a) : `${String(a)}-${String(b)}`)).join(' '),
          p.examples.join(' | '),
          p.steps.join(' '),
        ]),
      ],
      [40, 7, 5, 6, 14, 40, 60],
    ).map((l) => '  ' + l),
  );
  out.push(
    '',
    '  Steps: msgs and addrs exclude meter traffic; first = first reply after the step began.',
    '  Patterns: count "Nt" = only seen in thinned meter snapshots (N ticks).',
  );
  return out;
}

export function summaryToJson(s: Summary): unknown {
  return {
    meta: s.meta,
    end: s.end,
    rx: s.rx,
    tx: s.tx,
    rates: s.rates,
    sources: [...s.sources],
    fileBytes: s.fileBytes,
    notes: s.notes,
    steps: s.steps.map((st) => ({ ...st, addresses: [...st.addresses].sort() })),
    patterns: [...s.patterns.values()]
      .sort((a, b) => a.pattern.localeCompare(b.pattern))
      .map((p) => ({ ...p, addresses: [...p.addresses].sort(), types: [...p.types] })),
  };
}
