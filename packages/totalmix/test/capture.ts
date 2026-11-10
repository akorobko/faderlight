// Reads capture files (tools/capture format, JSON Lines) for adaptor and client tests.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePacket, messagesOf, type OscMessage } from '@faderlight/osc';

export const capturesDir = join(import.meta.dirname, '../../../fixtures/captures');

/** The baseline capture the protocol spec was written from. */
export const BASELINE = join(capturesDir, 'fireface-ufx-iii-unknown-2026-11-09.jsonl');

export interface Datagram {
  /** Milliseconds since the capture started. */
  readonly t: number;
  readonly raw: Uint8Array;
  readonly messages: readonly OscMessage[];
  /** Every message is a meter level. */
  readonly meter: boolean;
}

export interface CaptureStep {
  readonly id: string;
  readonly kind: string | undefined;
  /** Datagrams this tool sent during the step. */
  readonly sent: Datagram[];
  /** Datagrams received from TotalMix during the step. */
  readonly received: Datagram[];
}

export interface Capture {
  readonly steps: readonly CaptureStep[];
  readonly received: readonly Datagram[];
  /** Meter addresses only recorded in thinned form (tick records), with their last value. */
  readonly thinnedLevels: ReadonlyMap<string, number>;
}

interface RawRecord {
  readonly k: string;
  readonly t: number;
  readonly id?: string;
  readonly phase?: string;
  readonly kind?: string;
  readonly raw?: string;
  readonly meter?: true;
  readonly levels?: Readonly<Record<string, readonly (readonly [string, number])[]>>;
}

export function captureFiles(): string[] {
  return readdirSync(capturesDir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => join(capturesDir, name));
}

const cache = new Map<string, Capture>();

export function readCapture(file: string): Capture {
  const cached = cache.get(file);
  if (cached) return cached;
  const steps: CaptureStep[] = [];
  const received: Datagram[] = [];
  const thinnedLevels = new Map<string, number>();
  let current: CaptureStep | undefined;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const r = JSON.parse(line) as RawRecord;
    if (r.k === 'step' && r.phase === 'begin' && r.id !== undefined) {
      current = { id: r.id, kind: r.kind, sent: [], received: [] };
      steps.push(current);
    } else if (r.k === 'step' && r.phase === 'end') {
      current = undefined;
    } else if ((r.k === 'rx' || r.k === 'tx') && r.raw !== undefined) {
      const raw = new Uint8Array(Buffer.from(r.raw, 'base64'));
      const d: Datagram = {
        t: r.t,
        raw,
        messages: messagesOf(decodePacket(raw)),
        meter: r.meter === true,
      };
      if (r.k === 'rx') {
        received.push(d);
        current?.received.push(d);
      } else {
        current?.sent.push(d);
      }
    } else if (r.k === 'tick' && r.levels) {
      for (const [address, args] of Object.entries(r.levels)) {
        const value = args[0]?.[1];
        if (typeof value === 'number') thinnedLevels.set(address, value);
      }
    }
  }
  const capture = { steps, received, thinnedLevels };
  cache.set(file, capture);
  return capture;
}

export function step(capture: Capture, id: string): CaptureStep {
  const s = capture.steps.find((x) => x.id === id);
  if (!s) throw new Error(`no step ${id} in the capture`);
  return s;
}
