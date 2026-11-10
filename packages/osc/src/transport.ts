// UDP transport for OSC: binds the feedback port, sends to the remote host, decodes datagrams.
//
// - A failed bind (port taken, address missing) or a socket error is retried with exponential
//   backoff until stop() is called, so a plugin survives TotalMix or another app holding the port.
// - Datagrams are accepted from any source port of the remote host: TotalMix sends from an
//   ephemeral port that changes when it restarts (docs/protocol/global-osc.md §1). The `source`
//   event reports every change, which is how a client notices a restart.
// - Liveness is not decided here. TotalMix has no heartbeat and its meters stop when levels
//   stop changing, so silence on the socket means nothing by itself; the TotalMix client polls
//   instead and uses `lastRxAt` and the `packet` events.

import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { isIP } from 'node:net';
import { Backoff, type BackoffOptions } from './backoff.ts';
import { decodePacket, encodePacket, OscDecodeError } from './codec.ts';
import { messagesOf, type OscMessage, type OscPacket } from './types.ts';

export interface Endpoint {
  readonly address: string;
  readonly port: number;
}

/**
 * closed: not started or stopped. binding: resolving the host and binding the port.
 * open: ready to send and receive. waiting: the last bind failed, a retry is scheduled.
 */
export type TransportState = 'closed' | 'binding' | 'open' | 'waiting';

export interface ReceivedPacket {
  readonly packet: OscPacket;
  /** Every message in the packet, bundles flattened in order. */
  readonly messages: readonly OscMessage[];
  readonly from: Endpoint;
  /** Datagram size in bytes. */
  readonly size: number;
  /** Arrival time on the transport's clock (`now`). */
  readonly at: number;
}

export interface UdpTransportOptions {
  /** Host running the remote OSC app (TotalMix: the computer it runs on, usually 127.0.0.1). */
  readonly host: string;
  /** Remote port we send to (TotalMix: "Port incoming", e.g. 7002). */
  readonly sendPort: number;
  /** Local port we receive on (TotalMix: "Port outgoing", e.g. 9002). 0 picks a free port. */
  readonly listenPort: number;
  /** Local address to bind. Default: 127.0.0.1 for a loopback host, otherwise 0.0.0.0. */
  readonly bindAddress?: string;
  /** Accept datagrams from any host, not just `host` (default false). */
  readonly acceptAnySource?: boolean;
  readonly backoff?: Partial<BackoffOptions>;
  /** Clock for `at` and `lastRxAt`, in milliseconds (default performance.now). */
  readonly now?: () => number;
  /** Random source for backoff jitter (default Math.random). */
  readonly random?: () => number;
}

export interface TransportStats {
  rxDatagrams: number;
  rxBytes: number;
  txDatagrams: number;
  /** Datagrams from hosts other than `host`. */
  dropped: number;
  decodeErrors: number;
}

export interface UdpTransportEvents {
  state: [state: TransportState];
  packet: [packet: ReceivedPacket];
  /** The sender's address or port changed; `previous` is undefined for the first datagram. */
  source: [current: Endpoint, previous: Endpoint | undefined];
  decodeError: [error: OscDecodeError, from: Endpoint];
  /** Bind, socket and send errors. Bind and socket errors are followed by a retry. */
  socketError: [error: Error];
}

const isLoopback = (host: string): boolean =>
  host === 'localhost' || host.startsWith('127.') || host === '::1';

const normalise = (address: string): string =>
  address.startsWith('::ffff:') ? address.slice(7) : address;

export class UdpTransport extends EventEmitter<UdpTransportEvents> {
  readonly stats: TransportStats = {
    rxDatagrams: 0,
    rxBytes: 0,
    txDatagrams: 0,
    dropped: 0,
    decodeErrors: 0,
  };

  private readonly options: UdpTransportOptions;
  private readonly now: () => number;
  private readonly backoff: Backoff;
  private currentState: TransportState = 'closed';
  private running = false;
  /** Bumped by start() and stop(), so a bind that finishes late knows it is stale. */
  private generation = 0;
  private socket: Socket | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private target: string | undefined;
  private accepted = new Set<string>();
  private lastSource: Endpoint | undefined;
  private lastRx: number | undefined;

  constructor(options: UdpTransportOptions) {
    super();
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.backoff = new Backoff(options.backoff, options.random);
  }

  get state(): TransportState {
    return this.currentState;
  }

  /** Arrival time of the last accepted datagram, or undefined. */
  get lastRxAt(): number | undefined {
    return this.lastRx;
  }

  /** The endpoint the last accepted datagram came from. */
  get source(): Endpoint | undefined {
    return this.lastSource;
  }

  /** The bound local port (useful with listenPort 0), or undefined when not open. */
  get localPort(): number | undefined {
    return this.currentState === 'open' ? this.socket?.address().port : undefined;
  }

  /** Starts binding; retries on failure until stop(). Calling it again does nothing. */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.attempt(++this.generation);
  }

  /** Closes the socket and cancels retries. */
  async stop(): Promise<void> {
    this.running = false;
    this.generation++;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.lastSource = undefined;
    if (socket) await closeSocket(socket);
    this.setState('closed');
  }

  /**
   * Sends one packet to host:sendPort. Returns false (and sends nothing) unless the transport
   * is open. Throws for packets that cannot be encoded.
   */
  send(packet: OscPacket): boolean {
    const bytes = encodePacket(packet);
    const socket = this.socket;
    if (this.currentState !== 'open' || socket === undefined || this.target === undefined) {
      return false;
    }
    socket.send(bytes, this.options.sendPort, this.target, (err) => {
      if (err) this.emit('socketError', err);
    });
    this.stats.txDatagrams++;
    return true;
  }

  private setState(state: TransportState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    this.emit('state', state);
  }

  private async attempt(generation: number): Promise<void> {
    this.retryTimer = undefined;
    this.setState('binding');
    let socket: Socket | undefined;
    try {
      const addresses = await this.resolve();
      if (generation !== this.generation) return;
      socket = createSocket('udp4');
      const bindAddress =
        this.options.bindAddress ?? (isLoopback(this.options.host) ? '127.0.0.1' : '0.0.0.0');
      await bindSocket(socket, this.options.listenPort, bindAddress);
      if (generation !== this.generation) {
        await closeSocket(socket);
        return;
      }
      this.accepted = new Set(addresses);
      this.target = addresses[0];
      const bound = socket;
      bound.on('message', (data, rinfo) => {
        this.receive(data, rinfo);
      });
      bound.on('error', (err) => {
        this.fail(err, bound);
      });
      this.socket = bound;
      this.backoff.reset();
      this.setState('open');
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (socket) await closeSocket(socket);
      if (generation === this.generation) this.fail(err, undefined);
    }
  }

  private async resolve(): Promise<string[]> {
    const { host } = this.options;
    if (isIP(host) === 4) return [host];
    if (isIP(host) === 6) throw new Error(`IPv6 hosts are not supported: ${host}`);
    const found = await lookup(host, { all: true, family: 4 });
    if (found.length === 0) throw new Error(`no IPv4 address for ${host}`);
    return found.map((a) => a.address);
  }

  private fail(err: Error, socket: Socket | undefined): void {
    this.emit('socketError', err);
    if (socket !== undefined && socket === this.socket) {
      this.socket = undefined;
      void closeSocket(socket);
    }
    if (!this.running || this.retryTimer !== undefined) return;
    this.setState('waiting');
    const generation = this.generation;
    this.retryTimer = setTimeout(() => void this.attempt(generation), this.backoff.next());
  }

  private receive(data: Buffer, rinfo: RemoteInfo): void {
    const address = normalise(rinfo.address);
    if (this.options.acceptAnySource !== true && !this.accepted.has(address)) {
      this.stats.dropped++;
      return;
    }
    const at = this.now();
    const from: Endpoint = { address, port: rinfo.port };
    this.stats.rxDatagrams++;
    this.stats.rxBytes += data.byteLength;
    this.lastRx = at;

    const previous = this.lastSource;
    if (previous?.address !== from.address || previous.port !== from.port) {
      this.lastSource = from;
      this.emit('source', from, previous);
    }

    let packet: OscPacket;
    try {
      packet = decodePacket(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } catch (e) {
      if (!(e instanceof OscDecodeError)) throw e;
      this.stats.decodeErrors++;
      this.emit('decodeError', e, from);
      return;
    }
    this.emit('packet', { packet, messages: messagesOf(packet), from, size: data.byteLength, at });
  }
}

function bindSocket(socket: Socket, port: number, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      socket.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      socket.off('error', onError);
      resolve();
    };
    socket.once('error', onError);
    socket.once('listening', onListening);
    socket.bind({ port, address, exclusive: true });
  });
}

function closeSocket(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    try {
      socket.close(() => {
        resolve();
      });
    } catch {
      // Already closed.
      resolve();
    }
  });
}
