// Record types of a capture file (JSON Lines, one record per line).
// The format is documented in tools/capture/README.md; bump FORMAT_VERSION on breaking changes.

import { createWriteStream, type WriteStream } from 'node:fs';
import type { JsonArg } from './osc.ts';

export const FORMAT_VERSION = 1;

export interface JsonMessage {
  /** OSC address. */
  readonly a: string;
  /** Arguments as [tag] or [tag, value] tuples. */
  readonly args: readonly JsonArg[];
}

export interface MetaRecord {
  readonly k: 'meta';
  readonly t: number;
  readonly format: number;
  readonly tool: string;
  readonly toolVersion: string;
  readonly command: string;
  readonly script?: string;
  readonly startedAt: string;
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
  readonly osRelease: string;
  readonly host: string;
  readonly sendPort: number;
  readonly listenPort: number;
  readonly bindAddress: string;
  readonly meters: MeterMode;
  readonly maxBytes: number;
  readonly vars: Readonly<Record<string, number>>;
  readonly tmfxVersion: string;
  readonly settingsAsDocumented: boolean | null;
  readonly userNote: string;
}

export interface StepRecord {
  readonly k: 'step';
  readonly t: number;
  readonly id: string;
  readonly phase: 'begin' | 'end';
  readonly kind?: string;
  readonly title?: string;
  /** The protocol question the step answers (begin record). */
  readonly why?: string;
  /** Messages the step sends, e.g. "/sendall f:2" (begin record). */
  readonly sends?: readonly string[];
  /** Outcome, e.g. "done", "skipped: ...", "no reply" (end record). */
  readonly result?: string;
  readonly stats?: StepStats;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface StepStats {
  readonly ms: number;
  readonly rxDatagrams: number;
  readonly rxMessages: number;
  readonly meterDatagrams: number;
  readonly meterMessages: number;
  readonly addresses: number;
  readonly firstRxMs: number | null;
  readonly lastRxMs: number | null;
}

export interface TxRecord {
  readonly k: 'tx';
  readonly t: number;
  readonly to: string;
  readonly raw: string;
  readonly msgs: readonly JsonMessage[];
  readonly step?: string;
}

export interface RxRecord {
  readonly k: 'rx';
  readonly t: number;
  readonly from: string;
  readonly size: number;
  /** Base64 of the datagram, exactly as received. */
  readonly raw: string;
  /** Decoded messages, bundles flattened in order. Absent when decoding failed. */
  readonly msgs?: readonly JsonMessage[];
  /** Top-level bundle timetag (hex), when the datagram is a bundle. */
  readonly tt?: string;
  /** True when bundles were nested inside the top-level bundle. */
  readonly nested?: true;
  readonly error?: string;
  /** True when every message is a meter message (kept because meters are recorded in full). */
  readonly meter?: true;
}

export interface TickRecord {
  readonly k: 'tick';
  readonly t: number;
  readonly ms: number;
  readonly rx: { readonly datagrams: number; readonly messages: number; readonly bytes: number };
  readonly meter: {
    readonly datagrams: number;
    readonly messages: number;
    /** Meter-only datagrams counted but not written as rx records. */
    readonly thinned: number;
  };
  /** Latest value of every meter address seen during this tick (only while meters are thinned). */
  readonly levels?: Readonly<Record<string, readonly JsonArg[]>>;
}

export interface NoteRecord {
  readonly k: 'note';
  readonly t: number;
  readonly level: 'info' | 'warn';
  readonly text: string;
  readonly step?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface EndRecord {
  readonly k: 'end';
  readonly t: number;
  readonly reason: 'done' | 'interrupted' | 'error';
  readonly totals: {
    readonly rxDatagrams: number;
    readonly rxMessages: number;
    readonly rxBytes: number;
    readonly txMessages: number;
    readonly meterThinned: number;
    readonly meterDroppedOverCap: number;
    readonly bytesWritten: number;
  };
  readonly device?: string;
  readonly unconfirmedRestores?: readonly string[];
}

export type CaptureRecord =
  MetaRecord | StepRecord | TxRecord | RxRecord | TickRecord | NoteRecord | EndRecord;

export type MeterMode = 'thin' | 'full' | 'off';

export interface RecordSink {
  write(record: CaptureRecord): void;
  /** Bytes written so far. */
  readonly bytes: number;
  close(): Promise<void>;
}

/** Serialises a record as one JSON line. Field order follows object construction order. */
export function toLine(record: CaptureRecord): string {
  return JSON.stringify(record) + '\n';
}

export class FileSink implements RecordSink {
  private readonly stream: WriteStream;
  private written = 0;
  private failed: Error | undefined;

  constructor(path: string) {
    this.stream = createWriteStream(path, { flags: 'wx', encoding: 'utf8' });
    this.stream.on('error', (err) => {
      this.failed = err;
    });
  }

  get bytes(): number {
    return this.written;
  }

  write(record: CaptureRecord): void {
    if (this.failed) throw this.failed;
    const line = toLine(record);
    this.written += Buffer.byteLength(line);
    this.stream.write(line);
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream.end((err?: Error | null) => {
        const e = err ?? this.failed;
        if (e) reject(e);
        else resolve();
      });
    });
  }
}

export class MemorySink implements RecordSink {
  readonly records: CaptureRecord[] = [];
  private written = 0;

  get bytes(): number {
    return this.written;
  }

  write(record: CaptureRecord): void {
    // Round-trip through JSON so tests see exactly what a file would contain.
    const line = toLine(record);
    this.written += Buffer.byteLength(line);
    this.records.push(JSON.parse(line) as CaptureRecord);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** Discards everything (used by `check`). */
export class NullSink implements RecordSink {
  readonly bytes = 0;

  write(): void {
    // Intentionally empty.
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
