// Shared test helpers: message text, a seeded random source and a UDP listener.
import { createSocket, type Socket } from 'node:dgram';
import { join } from 'node:path';
import {
  decodePacket,
  encodeMessage,
  float,
  formatMessage,
  message,
  messagesOf,
  str,
  type OscMessage,
  type OscPacket,
} from '@faderlight/osc';
import type { Emission } from '../src/index.ts';

export const BASELINE = join(
  import.meta.dirname,
  '../../../fixtures/captures/fireface-ufx-iii-unknown-2026-11-09.jsonl',
);

/** Emissions as lists of message texts, e.g. [["/input/8/mute f:1"]]. */
export const texts = (emissions: readonly Emission[]): string[][] =>
  emissions.map((e) => e.map(formatMessage));

/** All messages of some emissions as text, flattened. */
export const flat = (emissions: readonly Emission[]): string[] => texts(emissions).flat();

export const req = (address: string, value = 1): OscMessage => message(address, float(value));
export const set = (address: string, value: number | string): OscMessage =>
  message(address, typeof value === 'string' ? str(value) : float(value));

/** Repeatable random numbers (mulberry32). */
export function seeded(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Received {
  readonly t: number;
  readonly from: number;
  readonly size: number;
  readonly packet: OscPacket;
  readonly messages: OscMessage[];
}

/** A UDP socket on 127.0.0.1 that records every datagram, standing in for a client. */
export class Listener {
  readonly received: Received[] = [];
  private socket: Socket | undefined;

  async start(): Promise<void> {
    const socket = createSocket('udp4');
    socket.on('message', (data, rinfo) => {
      const packet = decodePacket(new Uint8Array(data));
      this.received.push({
        t: performance.now(),
        from: rinfo.port,
        size: data.byteLength,
        packet,
        messages: messagesOf(packet),
      });
    });
    await new Promise<void>((resolve) => {
      socket.bind(0, '127.0.0.1', resolve);
    });
    this.socket = socket;
  }

  get port(): number {
    return this.socket?.address().port ?? 0;
  }

  /** Sends each message as a plain datagram, like a client that does not bundle requests. */
  send(port: number, ...messages: OscMessage[]): void {
    for (const m of messages) this.socket?.send(encodeMessage(m), port, '127.0.0.1');
  }

  /** Message texts received so far, without meters unless asked. */
  texts(meters = false): string[] {
    return this.received
      .flatMap((r) => r.messages)
      .filter((m) => meters || !m.address.startsWith('/level/'))
      .map(formatMessage);
  }

  clear(): void {
    this.received.length = 0;
  }

  async stop(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      await new Promise<void>((resolve) => {
        socket.close(() => {
          resolve();
        });
      });
    }
  }
}

export async function until(
  condition: () => boolean,
  what: string,
  timeoutMs = 3000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
