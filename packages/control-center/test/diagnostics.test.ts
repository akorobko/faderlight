import { afterEach, describe, expect, it } from 'vitest';
import { Simulator } from '@faderlight/simulator';
import { connectTotalMix, type TotalMixConnection } from '@faderlight/totalmix';
import { Diagnostics, PacketLog, UNSOLICITED_AFTER_MS } from '../src/diagnostics.ts';

const entry = (address: string, meter = false) =>
  ({ at: 0, dir: 'in', address, args: '', meter }) as const;

describe('PacketLog', () => {
  it('keeps the newest entries, numbered, up to its capacity', () => {
    const log = new PacketLog(3);
    for (const a of ['/a', '/b', '/c', '/d']) log.add(entry(a));
    expect(log.since().map((e) => [e.n, e.address])).toEqual([
      [2, '/b'],
      [3, '/c'],
      [4, '/d'],
    ]);
    expect(log.last).toBe(4);
    expect(log.since(3).map((e) => e.address)).toEqual(['/d']);
    expect(log.since(4)).toEqual([]);
  });

  it('leaves meter messages out unless asked', () => {
    const log = new PacketLog();
    log.add(entry('/level/in/8', true));
    expect(log.since()).toEqual([]);
    log.meters = true;
    log.add(entry('/level/in/8', true));
    expect(log.since()).toHaveLength(1);
  });

  it('clears, and keeps numbering after a clear', () => {
    const log = new PacketLog();
    log.add(entry('/a'));
    log.clear();
    log.add(entry('/b'));
    expect(log.since().map((e) => e.n)).toEqual([2]);
  });
});

describe('Diagnostics against the simulator', () => {
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  interface Setup {
    readonly sim: Simulator;
    readonly conn: TotalMixConnection;
    readonly d: Diagnostics;
    readonly report: () => ReturnType<Diagnostics['report']>;
  }

  async function start(meters: boolean): Promise<Setup> {
    const sim = new Simulator({ portIn: 0, feedbackPort: 'sender', meters: meters ? {} : false });
    await sim.start();
    cleanups.push(() => sim.stop());
    const conn = connectTotalMix({
      host: '127.0.0.1',
      sendPort: sim.port,
      listenPort: 0,
      syncQuietMs: 40,
    });
    cleanups.push(() => conn.stop());
    const d = new Diagnostics();
    d.attach(conn, { host: '127.0.0.1', sendPort: sim.port, listenPort: 0 });
    await until(() => conn.client.state === 'live');
    return { sim, conn, d, report: () => d.report(conn.store) };
  }

  it('logs both directions and counts what arrives', async () => {
    const { sim, d, report } = await start(false);
    const r = report();
    expect(r).toMatchObject({
      transport: 'open',
      link: 'live',
      synced: true,
      device: 'Fireface UFX III',
      sendPort: sim.port,
    });
    expect(r.localPort).toBeGreaterThan(0);
    expect(r.rx.messages).toBeGreaterThan(100);
    expect(r.rx.meters).toBe(0);
    expect(r.source).toMatch(/^127\.0\.0\.1:\d+$/);
    const log = d.log.since();
    expect(log.find((e) => e.dir === 'out')).toMatchObject({ address: '/sendstate', args: 'f:1' });
    expect(log.find((e) => e.address === '/status/device')).toMatchObject({
      dir: 'in',
      // The serial number is masked, and kept apart for a page that asks for it.
      args: 's:"Fireface UFX III (XXXXXXXX)"',
      unmasked: 's:"Fireface UFX III (00000000)"',
    });
    // Nothing else has an unmasked copy.
    expect(log.filter((e) => e.unmasked !== undefined).map((e) => e.address)).toEqual(
      log.filter((e) => e.address === '/status/device').map((e) => e.address),
    );
  });

  it('counts meters, and a change made in TotalMix as unsolicited', async () => {
    const { sim, report } = await start(true);
    await until(() => report().rx.meters > 0);
    expect(report().unsolicited).toBe(0);
    // Wait until the last request is long enough ago that feedback cannot be its reply.
    await until(() => (report().tx.lastAgoMs ?? 0) > UNSOLICITED_AFTER_MS + 20);
    sim.change('/input/8/mute', 1);
    await until(() => report().unsolicited > 0);
    expect(report().lastUnsolicitedAgoMs).toBeLessThan(1000);
  });

  it('reports a port that another app holds', async () => {
    const blocker = connectTotalMix({ host: '127.0.0.1', sendPort: 1, listenPort: 0 });
    cleanups.push(() => blocker.stop());
    await until(() => blocker.transport.localPort !== undefined);
    const port = blocker.transport.localPort ?? 0;
    const conn = connectTotalMix({ host: '127.0.0.1', sendPort: 1, listenPort: port });
    cleanups.push(() => conn.stop());
    const d = new Diagnostics();
    d.attach(conn, { host: '127.0.0.1', sendPort: 1, listenPort: port });
    await until(() => d.report(conn.store).error !== undefined);
    expect(d.report(conn.store).error?.code).toBe('EADDRINUSE');
    expect(d.report(conn.store).transport).not.toBe('open');
  });
});

async function until(test: () => boolean, timeoutMs = 4000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!test()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
