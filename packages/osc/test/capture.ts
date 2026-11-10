// Reads the received datagrams of a capture file (tools/capture format, JSON Lines).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const capturesDir = join(import.meta.dirname, '../../../fixtures/captures');

export interface CapturedDatagram {
  /** Line number in the capture file (1-based), for test names. */
  readonly line: number;
  readonly raw: Uint8Array;
  /** Messages as the capture tool decoded them: address and [tag, value] tuples. */
  readonly msgs: readonly {
    readonly a: string;
    readonly args: readonly (readonly [string] | readonly [string, number | string])[];
  }[];
}

export function captureFiles(): string[] {
  return readdirSync(capturesDir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => join(capturesDir, name));
}

export function receivedDatagrams(file: string): CapturedDatagram[] {
  const out: CapturedDatagram[] = [];
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, i) => {
      if (text.trim() === '') return;
      const record = JSON.parse(text) as {
        k: string;
        raw?: string;
        msgs?: CapturedDatagram['msgs'];
      };
      if (record.k !== 'rx' || record.raw === undefined || record.msgs === undefined) return;
      out.push({
        line: i + 1,
        raw: new Uint8Array(Buffer.from(record.raw, 'base64')),
        msgs: record.msgs,
      });
    });
  return out;
}
