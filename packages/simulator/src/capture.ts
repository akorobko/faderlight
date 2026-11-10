// Reads capture files (JSON Lines, written by tools/capture; format in tools/capture/README.md)
// for replay, for loading a recorded mixer state and for the conformance test.

import { readFileSync } from 'node:fs';
import { decodePacket, messagesOf, type OscMessage } from '@faderlight/osc';

export interface CapturedDatagram {
  /** Milliseconds since the capture started. */
  readonly t: number;
  readonly raw: Uint8Array;
  readonly messages: readonly OscMessage[];
  /** Every message is a meter level. */
  readonly meter: boolean;
  /** Sender as "address:port" (received datagrams), or receiver (sent ones). */
  readonly peer: string;
  /** Id of the capture step it belongs to, if any. */
  readonly step: string | undefined;
}

export interface CaptureStep {
  readonly id: string;
  readonly kind: string | undefined;
  readonly t: number;
  /** Datagrams the capture tool sent during the step. */
  readonly sent: readonly CapturedDatagram[];
  /** Datagrams received from TotalMix during the step. */
  readonly received: readonly CapturedDatagram[];
}

export interface Capture {
  readonly steps: readonly CaptureStep[];
  /** Every received datagram, in order. */
  readonly received: readonly CapturedDatagram[];
  /** Every sent datagram, in order. */
  readonly sent: readonly CapturedDatagram[];
}

interface RawRecord {
  readonly k: string;
  readonly t: number;
  readonly id?: string;
  readonly phase?: string;
  readonly kind?: string;
  readonly raw?: string;
  readonly from?: string;
  readonly to?: string;
  readonly meter?: true;
}

interface MutableStep {
  readonly id: string;
  readonly kind: string | undefined;
  readonly t: number;
  readonly sent: CapturedDatagram[];
  readonly received: CapturedDatagram[];
}

/** Parses a capture file's text. Lines that are not JSON records throw. */
export function parseCapture(text: string): Capture {
  const steps: MutableStep[] = [];
  const received: CapturedDatagram[] = [];
  const sent: CapturedDatagram[] = [];
  let current: MutableStep | undefined;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const r = JSON.parse(line) as RawRecord;
    if (r.k === 'step' && r.phase === 'begin' && r.id !== undefined) {
      current = { id: r.id, kind: r.kind, t: r.t, sent: [], received: [] };
      steps.push(current);
    } else if (r.k === 'step' && r.phase === 'end') {
      current = undefined;
    } else if ((r.k === 'rx' || r.k === 'tx') && r.raw !== undefined) {
      const raw = new Uint8Array(Buffer.from(r.raw, 'base64'));
      const d: CapturedDatagram = {
        t: r.t,
        raw,
        messages: messagesOf(decodePacket(raw)),
        meter: r.meter === true,
        peer: (r.k === 'rx' ? r.from : r.to) ?? '',
        step: current?.id,
      };
      (r.k === 'rx' ? received : sent).push(d);
      (r.k === 'rx' ? current?.received : current?.sent)?.push(d);
    }
  }
  return { steps, received, sent };
}

export function readCapture(file: string): Capture {
  return parseCapture(readFileSync(file, 'utf8'));
}

export function findStep(capture: Capture, id: string): CaptureStep | undefined {
  return capture.steps.find((s) => s.id === id);
}

/** True for a meter level message. */
export const isMeter = (m: OscMessage): boolean => m.address.startsWith('/level/');
