// UDP recorder: binds the feedback port, sends commands to TotalMix and writes every
// datagram in both directions to a RecordSink, with timestamps.
//
// Meter traffic can be far heavier than everything else (one level message per channel,
// many times a second), so by default meter-only datagrams are "thinned": they are
// counted, and the latest value per meter address is written once per tick, instead of
// writing every datagram. Steps can switch to full meter recording for a short window.

import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { performance } from 'node:perf_hooks';
import {
  argToJson,
  decodePacket,
  encodeMessage,
  flatten,
  OscDecodeError,
  toBase64,
  type FlatMessage,
  type OscArg,
  type OscMessage,
} from './osc.ts';
import type {
  CaptureRecord,
  JsonMessage,
  MeterMode,
  RecordSink,
  RxRecord,
  StepStats,
} from './records.ts';

export interface RecorderOptions {
  /** TotalMix host (where commands are sent). */
  readonly host: string;
  /** TotalMix "Port incoming": we send commands here. */
  readonly sendPort: number;
  /** TotalMix "Port outgoing": we listen here. 0 picks a free port (tests). */
  readonly listenPort: number;
  /** Local address to bind; defaults to 127.0.0.1 for a loopback host, else 0.0.0.0. */
  readonly bindAddress?: string;
  readonly meters: MeterMode;
  /** Addresses matching this are meter traffic. */
  readonly meterPattern: RegExp;
  /** Once the sink holds this many bytes, meter-only datagrams are no longer written. */
  readonly maxBytes: number;
  /** Interval of tick records (rates and thinned meter snapshots). */
  readonly tickMs: number;
  readonly sink: RecordSink;
}

/** One received datagram, as seen by listeners. */
export interface RxEvent {
  readonly t: number;
  /** Sender as "address:port". */
  readonly from: string;
  readonly messages: readonly OscMessage[];
  /** Every message is meter traffic (see Recorder.isMeter). */
  readonly meterOnly: boolean;
  readonly size: number;
  readonly error?: string;
}

interface Counters {
  datagrams: number;
  messages: number;
  bytes: number;
  meterDatagrams: number;
  meterMessages: number;
  thinned: number;
}

function zero(): Counters {
  return { datagrams: 0, messages: 0, bytes: 0, meterDatagrams: 0, meterMessages: 0, thinned: 0 };
}

interface StepState {
  readonly id: string;
  readonly start: number;
  readonly counters: Counters;
  readonly addresses: Set<string>;
  firstRx: number | null;
  lastRx: number | null;
}

export interface ValueEntry {
  readonly args: readonly OscArg[];
  /** Recorder time (ms) of the last update. */
  readonly t: number;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

export function jsonMessage(m: OscMessage): JsonMessage {
  return { a: m.address, args: m.args.map(argToJson) };
}

export class Recorder {
  readonly options: RecorderOptions;
  readonly bindAddress: string;
  /** Latest value TotalMix reported for every non-meter address (received traffic only). */
  readonly values = new Map<string, ValueEntry>();

  private socket: Socket | undefined;
  private readonly t0 = performance.now();
  private readonly listeners = new Set<(e: RxEvent) => void>();
  private readonly highRate = new Set<string>();
  private tickTimer: NodeJS.Timeout | undefined;
  private tickStart = 0;
  private tick: Counters = zero();
  private tickLevels = new Map<string, readonly OscArg[]>();
  private readonly totals = { ...zero(), tx: 0, droppedOverCap: 0 };
  private step: StepState | undefined;
  private fullMeters = false;
  private capWarned = false;
  private boundPort = 0;
  private closed = false;

  constructor(options: RecorderOptions) {
    this.options = options;
    this.bindAddress = options.bindAddress ?? (isLoopback(options.host) ? '127.0.0.1' : '0.0.0.0');
  }

  /** Milliseconds since the recorder was created (monotonic). */
  now(): number {
    return round3(performance.now() - this.t0);
  }

  get port(): number {
    return this.boundPort;
  }

  get stats(): Readonly<typeof this.totals> {
    return this.totals;
  }

  write(record: CaptureRecord): void {
    if (!this.closed) this.options.sink.write(record);
  }

  async start(): Promise<void> {
    const socket = createSocket({ type: 'udp4', reuseAddr: false });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException): void => {
        socket.close();
        if (err.code === 'EADDRINUSE') {
          reject(
            new Error(
              `UDP port ${String(this.options.listenPort)} is already in use on ${this.bindAddress}. ` +
                'Quit the other program that listens there (another Stream Deck plugin, Companion, ' +
                'TouchOSC bridge, an earlier capture), or pick another port with --listen-port and ' +
                'set the same "Port outgoing" in TotalMix.',
            ),
          );
        } else {
          reject(err);
        }
      };
      socket.once('error', onError);
      socket.bind(this.options.listenPort, this.bindAddress, () => {
        socket.off('error', onError);
        resolve();
      });
    });
    this.boundPort = socket.address().port;
    socket.on('message', (msg, rinfo) => {
      this.onDatagram(msg, rinfo);
    });
    socket.on('error', (err) => {
      this.note('warn', `socket error: ${err.message}`);
    });
    this.tickStart = this.now();
    this.tickTimer = setInterval(() => {
      this.flushTick();
    }, this.options.tickMs);
    this.tickTimer.unref();
  }

  async stop(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    this.flushTick();
    const socket = this.socket;
    this.socket = undefined;
    if (socket)
      await new Promise<void>((resolve) =>
        socket.close(() => {
          resolve();
        }),
      );
  }

  /** Stops writing (after the end record) and closes the sink. */
  async closeSink(): Promise<void> {
    this.closed = true;
    await this.options.sink.close();
  }

  onRx(listener: (e: RxEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Meter traffic: matches the meter pattern, or was classified as high-rate. */
  isMeter(address: string): boolean {
    return this.options.meterPattern.test(address) || this.highRate.has(address);
  }

  /**
   * Treats these addresses like meters from now on (thinned, ignored when waiting for
   * replies). Used for unprompted high-rate traffic that the meter pattern does not cover.
   */
  addMeterAddresses(addresses: Iterable<string>): void {
    for (const a of addresses) this.highRate.add(a);
  }

  /** Records meters in full (every datagram) until switched off again. */
  setFullMeters(on: boolean): void {
    this.fullMeters = on;
  }

  async send(message: OscMessage): Promise<void> {
    const socket = this.socket;
    if (!socket) throw new Error('recorder is not running');
    const bytes = encodeMessage(message);
    const t = this.now();
    this.write({
      k: 'tx',
      t,
      to: `${this.options.host}:${String(this.options.sendPort)}`,
      raw: toBase64(bytes),
      msgs: [jsonMessage(message)],
      ...(this.step ? { step: this.step.id } : {}),
    });
    this.totals.tx++;
    await new Promise<void>((resolve, reject) => {
      socket.send(bytes, this.options.sendPort, this.options.host, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  note(level: 'info' | 'warn', text: string, detail?: Record<string, unknown>): void {
    this.write({
      k: 'note',
      t: this.now(),
      level,
      text,
      ...(this.step ? { step: this.step.id } : {}),
      ...(detail ? { detail } : {}),
    });
  }

  beginStep(
    id: string,
    kind: string,
    title: string,
    extra: { why?: string; sends?: readonly string[] } = {},
  ): void {
    if (this.step) this.endStep('aborted');
    this.flushTick(true);
    const t = this.now();
    this.step = {
      id,
      start: t,
      counters: zero(),
      addresses: new Set(),
      firstRx: null,
      lastRx: null,
    };
    this.write({
      k: 'step',
      t,
      id,
      phase: 'begin',
      kind,
      title,
      ...(extra.why === undefined ? {} : { why: extra.why }),
      ...(extra.sends === undefined || extra.sends.length === 0 ? {} : { sends: extra.sends }),
    });
  }

  /** Ends the current step and returns its statistics. */
  endStep(result: string, detail?: Record<string, unknown>): StepStats {
    const s = this.step;
    const t = this.now();
    if (!s) {
      return {
        ms: 0,
        rxDatagrams: 0,
        rxMessages: 0,
        meterDatagrams: 0,
        meterMessages: 0,
        addresses: 0,
        firstRxMs: null,
        lastRxMs: null,
      };
    }
    this.flushTick(true);
    const stats: StepStats = {
      ms: round3(t - s.start),
      rxDatagrams: s.counters.datagrams,
      rxMessages: s.counters.messages,
      meterDatagrams: s.counters.meterDatagrams,
      meterMessages: s.counters.meterMessages,
      addresses: s.addresses.size,
      firstRxMs: s.firstRx === null ? null : round3(s.firstRx - s.start),
      lastRxMs: s.lastRx === null ? null : round3(s.lastRx - s.start),
    };
    this.write({
      k: 'step',
      t,
      id: s.id,
      phase: 'end',
      result,
      stats,
      ...(detail ? { detail } : {}),
    });
    this.step = undefined;
    return stats;
  }

  get currentStep(): string | undefined {
    return this.step?.id;
  }

  /** Addresses (non-meter) received during the current step. */
  stepAddresses(): ReadonlySet<string> {
    return this.step?.addresses ?? new Set();
  }

  private onDatagram(buf: Buffer, rinfo: RemoteInfo): void {
    const t = this.now();
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    let flat: FlatMessage[] = [];
    let error: string | undefined;
    let timetag: bigint | undefined;
    let nested = false;
    try {
      const packet = decodePacket(bytes);
      flat = flatten(packet);
      if (packet.kind === 'bundle') timetag = packet.bundle.timetag;
      nested = flat.some((m) => m.depth > 1);
    } catch (err) {
      error = err instanceof OscDecodeError ? err.message : String(err);
    }
    const messages = flat.map((m) => m.message);
    const meterCount = messages.filter((m) => this.isMeter(m.address)).length;
    const meterOnly = messages.length > 0 && meterCount === messages.length;

    for (const c of [this.tick, this.totals, ...(this.step ? [this.step.counters] : [])]) {
      c.datagrams++;
      c.messages += messages.length;
      c.bytes += bytes.byteLength;
      c.meterMessages += meterCount;
      if (meterOnly) c.meterDatagrams++;
    }

    for (const m of messages) {
      if (this.isMeter(m.address)) {
        if (this.options.meters === 'thin') this.tickLevels.set(m.address, m.args);
      } else {
        this.values.set(m.address, { args: m.args, t });
        this.step?.addresses.add(m.address);
      }
    }
    if (this.step && !meterOnly) {
      this.step.firstRx ??= t;
      this.step.lastRx = t;
    }

    let writeIt = true;
    if (meterOnly) {
      if (this.options.meters === 'off' || (this.options.meters === 'thin' && !this.fullMeters)) {
        writeIt = false;
        this.tick.thinned++;
        this.totals.thinned++;
        if (this.step) this.step.counters.thinned++;
      } else if (this.options.sink.bytes >= this.options.maxBytes) {
        writeIt = false;
        this.totals.droppedOverCap++;
        if (!this.capWarned) {
          this.capWarned = true;
          this.note(
            'warn',
            `capture file reached ${String(Math.round(this.options.maxBytes / 1e6))} MB; ` +
              'meter-only datagrams are no longer written (counts continue in tick records)',
          );
        }
      }
    }

    if (writeIt) {
      const record: RxRecord = {
        k: 'rx',
        t,
        from: `${rinfo.address}:${String(rinfo.port)}`,
        size: bytes.byteLength,
        raw: toBase64(bytes),
        ...(error === undefined ? { msgs: messages.map(jsonMessage) } : { error }),
        ...(timetag === undefined ? {} : { tt: '0x' + timetag.toString(16).padStart(16, '0') }),
        ...(nested ? { nested: true as const } : {}),
        ...(meterOnly ? { meter: true as const } : {}),
      };
      this.write(record);
    }

    const event: RxEvent = {
      t,
      from: `${rinfo.address}:${String(rinfo.port)}`,
      messages,
      meterOnly,
      size: bytes.byteLength,
      ...(error === undefined ? {} : { error }),
    };
    for (const l of this.listeners) l(event);
  }

  /** Writes a tick record. At step boundaries (`boundary`) only when there was traffic. */
  private flushTick(boundary = false): void {
    const t = this.now();
    const ms = round3(t - this.tickStart);
    const c = this.tick;
    if (ms <= 0 || (boundary && c.datagrams === 0)) return;
    const levels =
      this.options.meters === 'thin' && this.tickLevels.size > 0
        ? Object.fromEntries([...this.tickLevels].map(([a, args]) => [a, args.map(argToJson)]))
        : undefined;
    this.write({
      k: 'tick',
      t,
      ms,
      rx: { datagrams: c.datagrams, messages: c.messages, bytes: c.bytes },
      meter: { datagrams: c.meterDatagrams, messages: c.meterMessages, thinned: c.thinned },
      ...(levels ? { levels } : {}),
    });
    this.tick = zero();
    this.tickLevels = new Map();
    this.tickStart = t;
  }
}
