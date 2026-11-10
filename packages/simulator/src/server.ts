// Simulator: a fake TotalMix FX on Global OSC over UDP. It receives on "Port incoming" and sends
// feedback from a separate ephemeral port to "Remote Controller Address":"Port outgoing", like
// TotalMix (docs/protocol/global-osc.md §1). The mixer (mixer.ts) decides what to send; this
// file adds sockets, timing, meters and faults.
//
// Like TotalMix, and unlike older references: there is no heartbeat. Nothing is sent unless
// asked for, except meter frames, changes made with change() (TotalMix's own window), and
// /durec/state plus one complete meter frame when it starts.

import { createSocket, type Socket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import {
  decodePacket,
  messagesOf,
  OscDecodeError,
  type Endpoint,
  type OscMessage,
} from '@faderlight/osc';
import { FaultInjector, type FaultOptions } from './faults.ts';
import { MeterEngine, METER_FRAME_MS, type SignalMap } from './meters.ts';
import { SimMixer, type Emission, type WireValue } from './mixer.ts';
import { pack } from './packer.ts';
import { meterSignals, studioMixer } from './scenarios.ts';

export interface SimulatorOptions {
  /** TotalMix "Port incoming", where requests and writes arrive (default 7002; 0 = any free port). */
  readonly portIn?: number;
  /** Local address to bind (default 127.0.0.1). */
  readonly bindAddress?: string;
  /** "Remote Controller Address": where feedback goes (default 127.0.0.1). */
  readonly feedbackHost?: string;
  /**
   * "Port outgoing" (default 9002). 'sender' sends feedback to wherever the last datagram came
   * from instead, which suits tests whose client listens on a free port.
   */
  readonly feedbackPort?: number | 'sender';
  /** Mixer state (default: the studio layout). */
  readonly mixer?: SimMixer;
  /**
   * Meter signals by channel, e.g. `{ 'in/8': { type: 'noise', db: -18 } }` (default: the
   * studio set for the mixer's visible strips). false turns "Send Level Data" off.
   */
  readonly meters?:
    | false
    | {
        readonly signals?: SignalMap;
        /** Time between meter frames (default 40 ms, as seen). */
        readonly intervalMs?: number;
      };
  /** Delay between a request and its reply (default 8 ms; the capture saw 6-20 ms). */
  readonly replyDelayMs?: number;
  readonly faults?: Partial<FaultOptions>;
  /** Random source for meters and faults (default Math.random); seed it for repeatable tests. */
  readonly random?: () => number;
}

/** stopped: never started or stopped. running: like TotalMix running. quit: like TotalMix closed. */
export type SimulatorState = 'stopped' | 'running' | 'quit';

export interface SimulatorEvents {
  state: [state: SimulatorState];
  /** A message arrived and was handled (datagrams lost to faults are not reported). */
  message: [message: OscMessage, from: Endpoint];
  /** A datagram went out. */
  sent: [datagram: Uint8Array, to: Endpoint];
  socketError: [error: Error];
}

export interface SimulatorStats {
  rxDatagrams: number;
  rxMessages: number;
  decodeErrors: number;
  txDatagrams: number;
  txBytes: number;
}

export class Simulator extends EventEmitter<SimulatorEvents> {
  readonly mixer: SimMixer;
  readonly meters: MeterEngine;
  readonly faults: FaultInjector;
  readonly stats: SimulatorStats = {
    rxDatagrams: 0,
    rxMessages: 0,
    decodeErrors: 0,
    txDatagrams: 0,
    txBytes: 0,
  };

  private readonly options: SimulatorOptions;
  private readonly replyDelayMs: number;
  private readonly meterIntervalMs: number;
  private sendLevels: boolean;
  private current: SimulatorState = 'stopped';
  private inSocket: Socket | undefined;
  private outSocket: Socket | undefined;
  private boundPort: number;
  private sender: Endpoint | undefined;
  private meterTimer: NodeJS.Timeout | undefined;
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(options: SimulatorOptions = {}) {
    super();
    this.options = options;
    const random = options.random ?? Math.random;
    this.mixer = options.mixer ?? studioMixer();
    const meters = options.meters;
    this.sendLevels = meters !== false;
    this.meterIntervalMs = (meters !== false ? meters?.intervalMs : undefined) ?? METER_FRAME_MS;
    this.meters = new MeterEngine(this.mixer, {
      signals:
        (meters !== false ? meters?.signals : undefined) ?? meterSignals('studio', this.mixer),
      random,
    });
    this.faults = new FaultInjector(options.faults, random);
    this.replyDelayMs = options.replyDelayMs ?? 8;
    this.boundPort = options.portIn ?? 7002;
  }

  get state(): SimulatorState {
    return this.current;
  }

  /** The port requests arrive on (useful with portIn 0), or 0 before the first start. */
  get port(): number {
    return this.inSocket?.address().port ?? this.boundPort;
  }

  /** The port feedback comes from; a new one after every start. Undefined unless running. */
  get sourcePort(): number | undefined {
    return this.outSocket?.address().port;
  }

  /** Where feedback goes now, or undefined (sender mode before anything arrived). */
  get feedbackTarget(): Endpoint | undefined {
    const port = this.options.feedbackPort ?? 9002;
    if (port === 'sender') return this.sender;
    return { address: this.options.feedbackHost ?? '127.0.0.1', port };
  }

  /** Starts, like launching TotalMix: binds the ports, sends /durec/state and a full meter frame. */
  async start(): Promise<void> {
    if (this.current === 'running') return;
    const address = this.options.bindAddress ?? '127.0.0.1';
    const inSocket = await bindUdp(this.boundPort, address);
    let outSocket: Socket;
    try {
      outSocket = await bindUdp(0, address);
    } catch (e) {
      await closeUdp(inSocket);
      throw e;
    }
    this.boundPort = inSocket.address().port;
    for (const socket of [inSocket, outSocket]) {
      socket.on('error', (err) => this.emit('socketError', err));
    }
    inSocket.on('message', (data, rinfo) => {
      this.receive(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), {
        address: rinfo.address,
        port: rinfo.port,
      });
    });
    this.inSocket = inSocket;
    this.outSocket = outSocket;
    this.setState('running');

    // Seen after a restart: /durec/state from the new port, then one complete meter frame.
    this.transmit([[this.mixer.durecMessage()]], 0);
    this.meters.reset();
    if (this.sendLevels) this.transmit([this.meters.fullFrame()], 0);
    this.meterTimer = setInterval(() => {
      this.meterFrame();
    }, this.meterIntervalMs);
  }

  /** Like quitting TotalMix: stops answering and sending, and frees both ports. */
  async quit(): Promise<void> {
    await this.shutdown('quit');
  }

  /** Quits, waits `downMs`, and starts again: feedback then comes from a new port. */
  async restart(downMs = 0): Promise<void> {
    await this.quit();
    if (downMs > 0) await new Promise((resolve) => setTimeout(resolve, downMs));
    await this.start();
  }

  /** Stops for good (until start() is called again). */
  async stop(): Promise<void> {
    await this.shutdown('stopped');
  }

  /**
   * A change made in TotalMix's window: applied to the mixer and sent as feedback at once.
   * Returns false when the value did not change (nothing is sent then).
   */
  change(address: string, value: WireValue | boolean): boolean {
    const emissions = this.mixer.change(address, value);
    this.send(emissions, 0);
    return emissions.length > 0;
  }

  /** Loads snapshot k (1-8) as if clicked in TotalMix. */
  loadSnapshot(k: number): void {
    this.send(this.mixer.loadSnapshot(k), 0);
  }

  /** TotalMix's "Send Level Data" option. */
  setSendLevels(on: boolean): void {
    this.sendLevels = on;
  }

  get levelsOn(): boolean {
    return this.sendLevels;
  }

  // --- internals --------------------------------------------------------------------------

  private setState(state: SimulatorState): void {
    if (state === this.current) return;
    this.current = state;
    this.emit('state', state);
  }

  private async shutdown(state: 'quit' | 'stopped'): Promise<void> {
    clearInterval(this.meterTimer);
    this.meterTimer = undefined;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    const sockets = [this.inSocket, this.outSocket];
    this.inSocket = this.outSocket = undefined;
    for (const s of sockets) if (s) await closeUdp(s);
    if (this.current !== 'stopped' || state === 'stopped') this.setState(state);
  }

  private receive(data: Uint8Array, from: Endpoint): void {
    if (this.current !== 'running') return;
    if (this.faults.dropIn()) return;
    this.stats.rxDatagrams++;
    this.sender = from;
    let messages: OscMessage[];
    try {
      messages = messagesOf(decodePacket(data));
    } catch (e) {
      if (!(e instanceof OscDecodeError)) throw e;
      this.stats.decodeErrors++;
      return;
    }
    for (const m of messages) {
      this.stats.rxMessages++;
      this.emit('message', m, from);
      this.send(this.mixer.handle(m), this.replyDelayMs);
    }
  }

  private meterFrame(): void {
    const frame = this.meters.frame(performance.now());
    if (this.sendLevels && frame.length > 0) this.transmit([frame], 0);
  }

  private send(emissions: readonly Emission[], delayMs: number): void {
    if (this.current === 'running') this.transmit(emissions, delayMs);
  }

  /** Packs each emission into its own datagrams and sends them through the fault injector. */
  private transmit(emissions: readonly Emission[], delayMs: number): void {
    for (const emission of emissions) {
      if (emission.length === 0) continue;
      for (const datagram of pack(emission)) {
        const verdict = this.faults.outgoing(datagram.byteLength);
        if (verdict.drop) continue;
        const delay = delayMs + verdict.delayMs;
        if (delay <= 0) {
          this.write(datagram);
          continue;
        }
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          this.write(datagram);
        }, delay);
        this.timers.add(timer);
      }
    }
  }

  private write(datagram: Uint8Array): void {
    const socket = this.outSocket;
    const to = this.feedbackTarget;
    if (!socket || !to) return;
    socket.send(datagram, to.port, to.address, (err) => {
      if (err) this.emit('socketError', err);
    });
    this.stats.txDatagrams++;
    this.stats.txBytes += datagram.byteLength;
    this.emit('sent', datagram, to);
  }
}

function bindUdp(port: number, address: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    const onError = (err: Error): void => {
      socket.close();
      reject(err);
    };
    socket.once('error', onError);
    socket.bind({ port, address, exclusive: true }, () => {
      socket.off('error', onError);
      resolve(socket);
    });
  });
}

function closeUdp(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    try {
      socket.close(() => {
        resolve();
      });
    } catch {
      resolve(); // already closed
    }
  });
}
