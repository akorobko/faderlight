// The simulator over UDP on 127.0.0.1: ports, timing, start and quit, meters and faults.
import { isBundle } from '@faderlight/osc';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_DATAGRAM_BYTES, Simulator, studioMixer, type SimulatorOptions } from '../src/index.ts';
import { Listener, req, set, sleep, until } from './helpers.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(
  options: SimulatorOptions = {},
  fixedPort = false,
): Promise<{ sim: Simulator; client: Listener }> {
  const client = new Listener();
  await client.start();
  cleanups.push(() => client.stop());
  const sim = new Simulator({
    portIn: 0,
    feedbackPort: fixedPort ? client.port : 'sender',
    meters: false,
    replyDelayMs: 1,
    ...options,
  });
  await sim.start();
  cleanups.push(() => sim.stop());
  return { sim, client };
}

describe('Simulator over UDP', () => {
  it('answers from a separate port, in bundles with timetag 0', async () => {
    const { sim, client } = await setup();
    client.send(sim.port, req('/sendstate'));
    await until(() => client.received.length > 0, 'a reply');
    const [reply] = client.received;
    expect(reply?.from).toBe(sim.sourcePort);
    expect(reply?.from).not.toBe(sim.port);
    expect(reply && isBundle(reply.packet) && reply.packet.timetag).toBe(0n);
    expect(client.texts()).toEqual([
      '/status/device s:"Fireface UFX III (00000000)"',
      '/status/connection f:1',
      '/status/dsp f:0',
      '/durec/state s:"Not ready"',
    ]);
  });

  it('waits the reply delay before answering', async () => {
    const { sim, client } = await setup({ replyDelayMs: 60 });
    const sentAt = performance.now();
    client.send(sim.port, req('/sendstate'));
    await until(() => client.received.length > 0, 'a reply');
    expect((client.received[0]?.t ?? 0) - sentAt).toBeGreaterThanOrEqual(55);
  });

  it('splits /sendall into datagrams of at most 480 bytes, snapshots last on their own', async () => {
    const { sim, client } = await setup();
    client.send(sim.port, req('/sendall', 1));
    await until(() => client.texts().some((t) => t.startsWith('/snapshot/load/8')), 'the dump');
    for (const r of client.received) expect(r.size).toBeLessThanOrEqual(MAX_DATAGRAM_BYTES);
    expect(client.received.at(-1)?.messages).toHaveLength(8);
    expect(client.texts().filter((t) => t.startsWith('/input/8/name'))).toEqual([
      '/input/8/name s:"Vocal"',
    ]);
  });

  it('sends feedback to the configured port, not to whoever asked', async () => {
    const { sim, client } = await setup({}, true);
    await until(() => client.received.length > 0, 'the start datagram');
    client.clear();
    const other = new Listener();
    await other.start();
    cleanups.push(() => other.stop());
    other.send(sim.port, req('/sendstate'));
    await until(() => client.received.length > 0, 'feedback');
    expect(other.received).toEqual([]);
  });

  it('has no heartbeat: without meters it only speaks when asked', async () => {
    const { client } = await setup({}, true);
    await sleep(300);
    expect(client.texts()).toEqual(['/durec/state s:"Not ready"']);
  });

  it('starts with /durec/state and one complete meter frame, then sends changes only', async () => {
    const { sim, client } = await setup(
      { meters: { signals: { 'in/8': { type: 'tone', db: -20 } }, intervalMs: 20 } },
      true,
    );
    await until(() => client.received.length >= 3, 'meter frames');
    const [boot, full, next] = client.received;
    expect(boot?.messages.map((m) => m.address)).toEqual(['/durec/state']);
    // Every visible channel of the studio layout, silent ones included.
    const visible = ['input', 'playback', 'output'] as const;
    const count = visible.reduce((n, bus) => n + sim.mixer.visibleChannels(bus).length, 0);
    expect(
      full?.messages.map((m) => m.address).filter((a) => a.startsWith('/level/')),
    ).toHaveLength(count);
    expect(next?.messages.map((m) => m.address)).toContain('/level/in/8');
    await sleep(100);
    // A steady tone does not change: nothing more for in/8, and nothing at all for silence.
    const later = client.received.slice(3).flatMap((r) => r.messages.map((m) => m.address));
    expect(later.filter((a) => a === '/level/in/8')).toEqual([]);
  });

  it('"Send Level Data" off stops meter frames', async () => {
    const { sim, client } = await setup(
      { meters: { signals: { 'in/8': { type: 'noise', db: -20 } }, intervalMs: 20 } },
      true,
    );
    await until(() => client.received.length >= 3, 'meter frames');
    sim.setSendLevels(false);
    await sleep(30);
    client.clear();
    await sleep(100);
    expect(client.received).toEqual([]);
  });

  it('quits like TotalMix: silence; a restart answers again from a new port', async () => {
    const { sim, client } = await setup({}, true);
    await until(() => client.received.length > 0, 'the start datagram');
    const before = sim.sourcePort;
    await sim.quit();
    expect(sim.state).toBe('quit');
    client.clear();
    client.send(sim.port, req('/sendstate'));
    await sleep(100);
    expect(client.received).toEqual([]);

    await sim.start();
    expect(sim.sourcePort).not.toBe(before);
    await until(() => client.received.length > 0, 'the start datagram');
    expect(client.texts()).toEqual(['/durec/state s:"Not ready"']);
    client.send(sim.port, req('/sendstate'));
    await until(() => client.texts().length > 1, 'a reply after the restart');
    expect(client.received.every((r) => r.from === sim.sourcePort)).toBe(true);
  });

  it('a change in TotalMix is sent at once; a write is not echoed', async () => {
    const { sim, client } = await setup({}, true);
    await until(() => client.received.length > 0, 'the start datagram');
    client.clear();
    client.send(sim.port, set('/input/8/mute', 1));
    await until(() => sim.stats.rxMessages > 0, 'the write');
    await sleep(50);
    expect(client.texts()).toEqual(['/snapshot/load/1 f:3']);
    expect(sim.change('/input/9/mute', true)).toBe(true);
    await until(() => client.texts().length > 1, 'feedback');
    expect(client.texts()[1]).toBe('/input/9/mute f:1');
  });

  it('loses every datagram with dropOutgoing 1, and every request with dropIncoming 1', async () => {
    const { sim, client } = await setup({ faults: { dropOutgoing: 1 } });
    client.send(sim.port, req('/sendstate'));
    await until(() => sim.stats.rxMessages > 0, 'the request');
    await sleep(50);
    expect(client.received).toEqual([]);
    expect(sim.faults.stats.droppedOutgoing).toBeGreaterThan(0);

    sim.faults.update({ dropOutgoing: 0, dropIncoming: 1 });
    client.send(sim.port, req('/sendstate'));
    await until(() => sim.faults.stats.droppedIncoming > 0, 'the drop');
    await sleep(50);
    expect(client.received).toEqual([]);
  });

  it('adds latency to everything it sends', async () => {
    const { sim, client } = await setup({ replyDelayMs: 0, faults: { latencyMs: 80 } });
    const sentAt = performance.now();
    client.send(sim.port, req('/sendstate'));
    await until(() => client.received.length > 0, 'a reply');
    expect((client.received[0]?.t ?? 0) - sentAt).toBeGreaterThanOrEqual(75);
  });

  it('uses the mixer it is given', async () => {
    const mixer = studioMixer();
    mixer.setValue('/input/8/name', 'Lead');
    const { sim, client } = await setup({ mixer });
    client.send(sim.port, req('/sendchan/input/8'));
    await until(() => client.received.length > 0, 'a reply');
    expect(client.texts()).toContain('/input/8/name s:"Lead"');
  });
});
