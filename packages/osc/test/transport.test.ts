import { createSocket, type Socket } from 'node:dgram';
import type { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Backoff,
  bundle,
  decodePacket,
  encodePacket,
  float,
  message,
  str,
  UdpTransport,
  type Endpoint,
  type TransportState,
  type UdpTransportEvents,
  type UdpTransportOptions,
} from '../src/index.ts';

// --- helpers --------------------------------------------------------------------------

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A UDP socket on 127.0.0.1 standing in for TotalMix. */
async function remote(): Promise<{ socket: Socket; port: number; received: Uint8Array[] }> {
  const socket = createSocket('udp4');
  const received: Uint8Array[] = [];
  socket.on('message', (data) => received.push(new Uint8Array(data)));
  await new Promise<void>((resolve) => {
    socket.bind(0, '127.0.0.1', resolve);
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        socket.close(() => {
          resolve();
        });
      }),
  );
  return { socket, port: socket.address().port, received };
}

function transport(options: Partial<UdpTransportOptions> = {}): UdpTransport {
  const t = new UdpTransport({ host: '127.0.0.1', sendPort: 9, listenPort: 0, ...options });
  cleanups.push(() => t.stop());
  return t;
}

function until<K extends keyof UdpTransportEvents>(
  t: UdpTransport,
  event: K,
  predicate: (...args: UdpTransportEvents[K]) => boolean = () => true,
  timeoutMs = 2000,
): Promise<UdpTransportEvents[K][0]> {
  // The untyped view of the emitter keeps this helper generic over event names.
  const emitter = t as unknown as EventEmitter;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, listener);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    const listener = (...args: UdpTransportEvents[K]): void => {
      if (!predicate(...args)) return;
      clearTimeout(timer);
      emitter.off(event, listener);
      resolve(args[0]);
    };
    emitter.on(event, listener);
  });
}

async function opened(t: UdpTransport): Promise<number> {
  const open = until(t, 'state', (s) => s === 'open');
  t.start();
  await open;
  const port = t.localPort;
  if (port === undefined) throw new Error('no local port');
  return port;
}

const sendFrom = (socket: Socket, port: number, bytes: Uint8Array): Promise<void> =>
  new Promise((resolve, reject) => {
    socket.send(bytes, port, '127.0.0.1', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// --- tests ----------------------------------------------------------------------------

describe('UdpTransport', () => {
  it('receives and decodes datagrams, bundles flattened', async () => {
    const t = transport();
    const port = await opened(t);
    const tm = await remote();
    const packet = bundle(
      [message('/status/device', str('Test device')), message('/status/connection', float(1))],
      0n,
    );
    const got = until(t, 'packet');
    await sendFrom(tm.socket, port, encodePacket(packet));
    const rx = await got;
    expect(rx.packet).toEqual(packet);
    expect(rx.messages.map((m) => m.address)).toEqual(['/status/device', '/status/connection']);
    expect(rx.from).toEqual({ address: '127.0.0.1', port: tm.port });
    expect(rx.size).toBe(encodePacket(packet).byteLength);
    expect(t.lastRxAt).toBe(rx.at);
    expect(t.stats.rxDatagrams).toBe(1);
    expect(t.stats.rxBytes).toBe(rx.size);
  });

  it('sends to host:sendPort once open, and refuses before', async () => {
    const tm = await remote();
    const t = transport({ sendPort: tm.port });
    expect(t.send(message('/sendstate', float(1)))).toBe(false);
    await opened(t);
    expect(t.send(message('/sendstate', float(1)))).toBe(true);
    for (let i = 0; i < 50 && tm.received.length === 0; i++) await sleep(10);
    expect(tm.received.map((b) => decodePacket(b))).toEqual([message('/sendstate', float(1))]);
    expect(t.stats.txDatagrams).toBe(1);
  });

  it('reports the first source and every change of source port (a TotalMix restart)', async () => {
    const t = transport();
    const port = await opened(t);
    const before = await remote();
    const after = await remote();
    const sources: [Endpoint, Endpoint | undefined][] = [];
    t.on('source', (current, previous) => sources.push([current, previous]));
    const bytes = encodePacket(message('/level/in/8', float(-50)));

    let got = until(t, 'packet');
    await sendFrom(before.socket, port, bytes);
    await got;
    got = until(t, 'packet');
    await sendFrom(before.socket, port, bytes);
    await got;
    got = until(t, 'packet');
    await sendFrom(after.socket, port, bytes);
    await got;

    const a = { address: '127.0.0.1', port: before.port };
    const b = { address: '127.0.0.1', port: after.port };
    expect(sources).toEqual([
      [a, undefined],
      [b, a],
    ]);
    expect(t.source).toEqual(b);
  });

  it('drops datagrams from other hosts', async () => {
    // 192.0.2.1 is a documentation address: nothing on this machine sends from it.
    const t = transport({ host: '192.0.2.1', bindAddress: '127.0.0.1' });
    const port = await opened(t);
    const tm = await remote();
    let packets = 0;
    t.on('packet', () => packets++);
    await sendFrom(tm.socket, port, encodePacket(message('/x')));
    for (let i = 0; i < 50 && t.stats.dropped === 0; i++) await sleep(10);
    expect(t.stats.dropped).toBe(1);
    expect(packets).toBe(0);
  });

  it('accepts other hosts with acceptAnySource', async () => {
    const t = transport({ host: '192.0.2.1', bindAddress: '127.0.0.1', acceptAnySource: true });
    const port = await opened(t);
    const tm = await remote();
    const got = until(t, 'packet');
    await sendFrom(tm.socket, port, encodePacket(message('/x')));
    expect((await got).messages).toEqual([message('/x')]);
  });

  it('reports undecodable datagrams and keeps running', async () => {
    const t = transport();
    const port = await opened(t);
    const tm = await remote();
    const errors: string[] = [];
    t.on('decodeError', (e) => errors.push(e.message));
    await sendFrom(tm.socket, port, new Uint8Array([1, 2, 3, 4]));
    const got = until(t, 'packet');
    await sendFrom(tm.socket, port, encodePacket(message('/ok')));
    await got;
    expect(errors).toHaveLength(1);
    expect(t.stats.decodeErrors).toBe(1);
  });

  it('retries a taken port with backoff and opens once it is free', async () => {
    const blocker = createSocket('udp4');
    await new Promise<void>((resolve) => {
      blocker.bind({ port: 0, address: '127.0.0.1', exclusive: true }, resolve);
    });
    const port = blocker.address().port;
    const t = transport({ listenPort: port, backoff: { initialMs: 20, maxMs: 40, jitter: 0 } });
    const states: TransportState[] = [];
    t.on('state', (s) => states.push(s));
    const errors: string[] = [];
    t.on('socketError', (e) => errors.push((e as NodeJS.ErrnoException).code ?? e.message));

    const waiting = until(t, 'state', (s) => s === 'waiting');
    t.start();
    await waiting;
    await sleep(100); // a few more failed attempts
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors[0]).toBe('EADDRINUSE');

    const open = until(t, 'state', (s) => s === 'open');
    await new Promise<void>((resolve) => {
      blocker.close(() => {
        resolve();
      });
    });
    await open;
    expect(t.localPort).toBe(port);
    expect(states.slice(0, 2)).toEqual(['binding', 'waiting']);
  });

  it('stops retrying after stop() and can start again', async () => {
    const blocker = createSocket('udp4');
    await new Promise<void>((resolve) => {
      blocker.bind({ port: 0, address: '127.0.0.1', exclusive: true }, resolve);
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          blocker.close(() => {
            resolve();
          });
        }),
    );
    const t = transport({
      listenPort: blocker.address().port,
      backoff: { initialMs: 10, jitter: 0 },
    });
    const waiting = until(t, 'state', (s) => s === 'waiting');
    t.start();
    await waiting;
    await t.stop();
    expect(t.state).toBe('closed');
    let errors = 0;
    t.on('socketError', () => errors++);
    await sleep(60);
    expect(errors).toBe(0);
  });

  it('closes on stop() and reopens on start()', async () => {
    const t = transport();
    await opened(t);
    await t.stop();
    expect(t.state).toBe('closed');
    expect(t.localPort).toBeUndefined();
    expect(t.send(message('/x'))).toBe(false);
    await opened(t);
    expect(t.state).toBe('open');
  });
});

describe('Backoff', () => {
  it('doubles from the initial delay up to the cap, without jitter', () => {
    const b = new Backoff({ initialMs: 100, maxMs: 1000, factor: 2, jitter: 0 });
    expect([b.next(), b.next(), b.next(), b.next(), b.next(), b.next()]).toEqual([
      100, 200, 400, 800, 1000, 1000,
    ]);
    expect(b.attempt).toBe(6);
    b.reset();
    expect(b.next()).toBe(100);
  });

  it('spreads delays by the jitter fraction and never exceeds the cap', () => {
    const low = new Backoff({ initialMs: 1000, maxMs: 1100, jitter: 0.2 }, () => 0);
    const high = new Backoff({ initialMs: 1000, maxMs: 1100, jitter: 0.2 }, () => 0.999999);
    expect(low.next()).toBe(800);
    expect(high.next()).toBe(1100);
  });

  it('uses 250 ms, doubling, 10 s cap by default', () => {
    const b = new Backoff({ jitter: 0 });
    const delays = Array.from({ length: 8 }, () => b.next());
    expect(delays).toEqual([250, 500, 1000, 2000, 4000, 8000, 10000, 10000]);
  });
});
