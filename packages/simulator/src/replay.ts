// Replay mode: plays a capture's received datagrams back to a client with their original timing,
// byte for byte. Every sender port in the capture gets a port of its own, so a TotalMix restart
// in the recording shows up as a new source port, as it did live. Requests from the client are
// not answered: this is a recording, not a mixer (use the Simulator for that).

import { createSocket, type Socket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import type { Capture, CapturedDatagram } from './capture.ts';

export interface ReplayOptions {
  /** Where to send ("Remote Controller Address", default 127.0.0.1). */
  readonly host?: string;
  /** "Port outgoing": the port the client listens on. */
  readonly port: number;
  /** Playback speed: 2 plays twice as fast (default 1). */
  readonly speed?: number;
  /** Include meter datagrams (default true). */
  readonly meters?: boolean;
  /** Only datagrams received during these capture steps (default: all). */
  readonly steps?: readonly string[];
  /** Local address for the sending sockets (default 127.0.0.1). */
  readonly bindAddress?: string;
}

export interface ReplayEvents {
  /** One datagram went out, from `sourcePort`. */
  sent: [datagram: CapturedDatagram, sourcePort: number];
  /** Everything was sent. */
  done: [];
}

/** The datagrams a replay sends, in order. */
export function replayedDatagrams(
  capture: Capture,
  options: Pick<ReplayOptions, 'meters' | 'steps'> = {},
): CapturedDatagram[] {
  const steps = options.steps ? new Set(options.steps) : undefined;
  return capture.received.filter(
    (d) =>
      (options.meters !== false || !d.meter) &&
      (steps === undefined || (d.step !== undefined && steps.has(d.step))),
  );
}

export class CaptureReplayer extends EventEmitter<ReplayEvents> {
  /** Resolves when every datagram was sent or the replay was stopped. */
  readonly done: Promise<void>;
  private readonly datagrams: readonly CapturedDatagram[];
  private readonly options: ReplayOptions;
  private readonly sockets = new Map<string, Socket>();
  private timer: NodeJS.Timeout | undefined;
  private next = 0;
  private startedAt = 0;
  private finish: () => void = () => undefined;

  constructor(capture: Capture, options: ReplayOptions) {
    super();
    if (!(options.speed === undefined || options.speed > 0)) {
      throw new RangeError('speed must be above 0');
    }
    this.options = options;
    this.datagrams = replayedDatagrams(capture, options);
    this.done = new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  /** Number of datagrams the replay sends. */
  get length(): number {
    return this.datagrams.length;
  }

  /** Local ports standing in for TotalMix's sender ports, in order of first use. */
  get sourcePorts(): number[] {
    return [...this.sockets.values()].map((s) => s.address().port);
  }

  async start(): Promise<void> {
    const address = this.options.bindAddress ?? '127.0.0.1';
    for (const d of this.datagrams) {
      if (this.sockets.has(d.peer)) continue;
      const socket = createSocket('udp4');
      await new Promise<void>((resolve) => {
        socket.bind(0, address, resolve);
      });
      this.sockets.set(d.peer, socket);
    }
    this.startedAt = performance.now();
    this.schedule();
  }

  async stop(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const socket of this.sockets.values()) {
      await new Promise<void>((resolve) => {
        socket.close(() => {
          resolve();
        });
      });
    }
    this.sockets.clear();
    this.finish();
  }

  private schedule(): void {
    const first = this.datagrams[0];
    const d = this.datagrams[this.next];
    if (!first || !d) {
      this.emit('done');
      this.finish();
      return;
    }
    const due = (d.t - first.t) / (this.options.speed ?? 1);
    const wait = Math.max(0, due - (performance.now() - this.startedAt));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.sendDue();
    }, wait);
  }

  private sendDue(): void {
    const first = this.datagrams[0];
    if (!first) return;
    const elapsed = performance.now() - this.startedAt;
    const speed = this.options.speed ?? 1;
    for (;;) {
      const d = this.datagrams[this.next];
      if (!d || (d.t - first.t) / speed > elapsed) break;
      const socket = this.sockets.get(d.peer);
      if (!socket) return; // stopped
      socket.send(d.raw, this.options.port, this.options.host ?? '127.0.0.1');
      this.next++;
      this.emit('sent', d, socket.address().port);
    }
    this.schedule();
  }
}
