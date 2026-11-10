// Diagnostics of the TotalMix connection for the Control Center: a packet log of the last
// messages in both directions, and counters and times the Setup Assistant (setup.ts) judges the
// connection by. TotalMix has no heartbeat and says nothing about its own settings, so "is Send
// Level Data on?" can only be answered by what arrives: meters, and state messages that are not
// replies to one of our requests ("Send changes").

import type { ConnectionSettings } from '@faderlight/deck';
import type { ConnectionState, MixerStore } from '@faderlight/model';
import {
  formatMessage,
  messagesOf,
  type OscMessage,
  type OscPacket,
  type ReceivedPacket,
  type TransportState,
} from '@faderlight/osc';
import type { TotalMixConnection } from '@faderlight/totalmix';

export type PacketDirection = 'in' | 'out';

export interface PacketEntry {
  /** Running number since the plugin started: the client asks for everything after one. */
  readonly n: number;
  /** Wall-clock time, ms since 1970. */
  readonly at: number;
  readonly dir: PacketDirection;
  readonly address: string;
  /** The arguments as text, e.g. `f:1` or `s:"Vocal"`, with any serial number masked. */
  readonly args: string;
  /**
   * The arguments with the serial number, where `args` masks one (/status/device). The page
   * shows it only when asked to, so a screenshot of the log never has one by accident.
   */
  readonly unmasked?: string | undefined;
  /** A level meter message (/level/...). */
  readonly meter: boolean;
  /** Something worth pointing out, e.g. "unknown address". */
  readonly note?: string | undefined;
}

/** The last `capacity` messages, oldest first. Meter messages only when `meters` is on. */
export class PacketLog {
  readonly capacity: number;
  /** Keep meter messages too (TotalMix sends dozens every 40 ms, so off by default). */
  meters = false;
  private entries: PacketEntry[] = [];
  private next = 1;

  constructor(capacity = 500) {
    this.capacity = capacity;
  }

  /** Number of the newest entry (0: none yet). */
  get last(): number {
    return this.next - 1;
  }

  add(entry: Omit<PacketEntry, 'n'>): void {
    if (entry.meter && !this.meters) return;
    this.entries.push({ ...entry, n: this.next++ });
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }

  /** Entries after number `n`, oldest first. */
  since(n = 0): PacketEntry[] {
    if (n <= 0) return [...this.entries];
    const i = this.entries.findIndex((e) => e.n > n);
    return i < 0 ? [] : this.entries.slice(i);
  }

  clear(): void {
    this.entries = [];
  }
}

export interface ConnectionReport {
  readonly host: string;
  readonly sendPort: number;
  readonly listenPort: number;
  /** The UDP socket: 'none' before the plugin made one. */
  readonly transport: TransportState | 'none';
  /** The port actually bound (differs from listenPort when that is 0). */
  readonly localPort?: number | undefined;
  readonly link: ConnectionState;
  /** How long the link has been in its state, ms. */
  readonly linkForMs: number;
  readonly device?: string | undefined;
  /** A full read of the mixer completed. */
  readonly synced: boolean;
  /** Values in the store. */
  readonly values: number;
  /** Where TotalMix sends from, e.g. "127.0.0.1:52391". */
  readonly source?: string | undefined;
  readonly rx: {
    readonly datagrams: number;
    readonly messages: number;
    readonly meters: number;
    readonly lastAgoMs?: number | undefined;
    readonly lastMeterAgoMs?: number | undefined;
  };
  readonly tx: { readonly datagrams: number; readonly lastAgoMs?: number | undefined };
  /** State messages that were no reply to a request of ours: changes made in TotalMix. */
  readonly unsolicited: number;
  readonly lastUnsolicitedAgoMs?: number | undefined;
  /** Messages the address map does not know, and datagrams that did not decode. */
  readonly unknown: number;
  readonly decodeErrors: number;
  /** Datagrams from another computer than TotalMix's. */
  readonly dropped: number;
  readonly error?:
    | { readonly message: string; readonly code?: string | undefined; readonly agoMs: number }
    | undefined;
}

/**
 * A state message this long after our last request was not a reply to it. TotalMix answers in
 * 6-20 ms (docs/protocol/global-osc.md §3); a slow full read takes about 100 ms.
 */
export const UNSOLICITED_AFTER_MS = 300;

const isMeter = (address: string): boolean => address.startsWith('/level/');
/** Status replies answer the client's polls; they say nothing about "Send changes". */
const isStatus = (address: string): boolean =>
  address.startsWith('/status/') || address.startsWith('/durec/');

/**
 * The arguments as text. TotalMix puts the interface's serial number into /status/device
 * ("Fireface UFX III (1234567)"): `args` masks it, and `unmasked` keeps it for a page that
 * asks for serial numbers (to tell two interfaces of the same model apart).
 */
const argsOf = (m: OscMessage): { args: string; unmasked?: string } => {
  const text = formatMessage(m);
  const args = text.length > m.address.length ? text.slice(m.address.length + 1) : '';
  if (m.address !== '/status/device') return { args };
  const masked = maskSerial(args);
  return masked === args ? { args } : { args: masked, unmasked: args };
};

/** "Fireface UFX III (1234567)" → "Fireface UFX III (XXXXXXX)". */
export const maskSerial = (s: string): string =>
  s.replace(/\(([^()]+)\)/g, (_m, serial: string) => `(${'X'.repeat(serial.length)})`);

const ago = (now: number, at: number | undefined): number | undefined =>
  at === undefined ? undefined : Math.max(0, now - at);

export interface DiagnosticsOptions {
  /** Messages kept in the packet log (default 500). */
  readonly capacity?: number;
  /** Wall clock (default Date.now). */
  readonly now?: () => number;
}

/** Watches one TotalMix connection at a time; attach() a new one after a reconnect. */
export class Diagnostics {
  readonly log: PacketLog;
  private readonly now: () => number;
  private settings: ConnectionSettings | undefined;
  private connection: TotalMixConnection | undefined;
  private detachers: (() => void)[] = [];
  private linkSince = 0;
  private rxMessages = 0;
  private rxMeters = 0;
  private lastRxAt: number | undefined;
  private lastMeterAt: number | undefined;
  private lastTxAt: number | undefined;
  private unsolicited = 0;
  private lastUnsolicitedAt: number | undefined;
  private unknown = 0;
  private error: { message: string; code?: string | undefined; at: number } | undefined;

  constructor(options: DiagnosticsOptions = {}) {
    this.log = new PacketLog(options.capacity);
    this.now = options.now ?? Date.now;
  }

  /** Follows a new connection (and forgets the counters of the previous one). */
  attach(connection: TotalMixConnection, settings: ConnectionSettings): void {
    this.detach();
    this.connection = connection;
    this.settings = settings;
    this.linkSince = this.now();
    this.rxMessages = this.rxMeters = this.unsolicited = this.unknown = 0;
    this.lastRxAt = this.lastMeterAt = this.lastTxAt = this.lastUnsolicitedAt = undefined;
    this.error = undefined;
    const { transport, client } = connection;
    const onPacket = (p: ReceivedPacket): void => {
      this.received(p.messages);
    };
    const onSent = (packet: OscPacket): void => {
      const at = this.now();
      this.lastTxAt = at;
      for (const m of messagesOf(packet)) {
        this.log.add({ at, dir: 'out', address: m.address, ...argsOf(m), meter: false });
      }
    };
    const onSocketError = (e: Error): void => {
      const code = (e as { code?: unknown }).code;
      this.error = {
        message: e.message,
        code: typeof code === 'string' ? code : undefined,
        at: this.now(),
      };
    };
    const onDecodeError = (): void => {
      this.unknown++;
      this.log.add({
        at: this.now(),
        dir: 'in',
        address: '?',
        args: '',
        meter: false,
        note: 'not OSC',
      });
    };
    const onState = (): void => {
      this.linkSince = this.now();
    };
    const onUnknown = (): void => {
      this.unknown++;
    };
    transport.on('packet', onPacket);
    transport.on('sent', onSent);
    transport.on('socketError', onSocketError);
    transport.on('decodeError', onDecodeError);
    client.on('state', onState);
    client.on('unknownMessage', onUnknown);
    this.detachers = [
      () => transport.off('packet', onPacket),
      () => transport.off('sent', onSent),
      () => transport.off('socketError', onSocketError),
      () => transport.off('decodeError', onDecodeError),
      () => client.off('state', onState),
      () => client.off('unknownMessage', onUnknown),
    ];
  }

  /** Stops following the connection (it was stopped). */
  detach(): void {
    for (const d of this.detachers) d();
    this.detachers = [];
    this.connection = undefined;
  }

  private received(messages: readonly OscMessage[]): void {
    const at = this.now();
    this.lastRxAt = at;
    const reply = this.lastTxAt !== undefined && at - this.lastTxAt < UNSOLICITED_AFTER_MS;
    const live = this.connection?.client.state === 'live';
    for (const m of messages) {
      this.rxMessages++;
      const meter = isMeter(m.address);
      if (meter) {
        this.rxMeters++;
        this.lastMeterAt = at;
      } else if (live && !reply && !isStatus(m.address)) {
        this.unsolicited++;
        this.lastUnsolicitedAt = at;
      }
      this.log.add({ at, dir: 'in', address: m.address, ...argsOf(m), meter });
    }
  }

  /** Everything the Setup Assistant and the Connection page show. */
  report(store: MixerStore): ConnectionReport {
    const now = this.now();
    const s = this.settings;
    const t = this.connection?.transport;
    const device = store.value({ scope: 'status', field: 'device' });
    const source = t?.source;
    return {
      host: s?.host ?? '',
      sendPort: s?.sendPort ?? 0,
      listenPort: s?.listenPort ?? 0,
      transport: t?.state ?? 'none',
      localPort: t?.localPort,
      link: store.connection,
      linkForMs: Math.max(0, now - this.linkSince),
      device: typeof device === 'string' ? device : undefined,
      synced: store.synced,
      values: store.size,
      source: source && `${source.address}:${String(source.port)}`,
      rx: {
        datagrams: t?.stats.rxDatagrams ?? 0,
        messages: this.rxMessages,
        meters: this.rxMeters,
        lastAgoMs: ago(now, this.lastRxAt),
        lastMeterAgoMs: ago(now, this.lastMeterAt),
      },
      tx: { datagrams: t?.stats.txDatagrams ?? 0, lastAgoMs: ago(now, this.lastTxAt) },
      unsolicited: this.unsolicited,
      lastUnsolicitedAgoMs: ago(now, this.lastUnsolicitedAt),
      unknown: this.unknown,
      decodeErrors: t?.stats.decodeErrors ?? 0,
      dropped: t?.stats.dropped ?? 0,
      error: this.error && {
        message: this.error.message,
        code: this.error.code,
        agoMs: Math.max(0, now - this.error.at),
      },
    };
  }
}
