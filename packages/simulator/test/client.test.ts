// End to end: the M1 TotalMix client (packages/totalmix) against the simulator over UDP.
// This is how later milestones (virtual deck, plugin) will run without hardware.
import {
  channel,
  controlRoom,
  mainOutput,
  strips,
  type ConnectionState,
  type Target,
  type Value,
} from '@faderlight/model';
import { connectTotalMix, type TotalMixConnection } from '@faderlight/totalmix';
import { afterEach, describe, expect, it } from 'vitest';
import { Simulator, type SimulatorOptions } from '../src/index.ts';
import { seeded, until } from './helpers.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(options: SimulatorOptions = {}): Promise<{
  sim: Simulator;
  conn: TotalMixConnection;
  states: ConnectionState[];
  failed: [Target, Value, string][];
}> {
  const sim = new Simulator({
    portIn: 0,
    feedbackPort: 'sender',
    meters: false,
    replyDelayMs: 2,
    ...options,
  });
  await sim.start();
  cleanups.push(() => sim.stop());
  const conn = connectTotalMix({
    host: '127.0.0.1',
    sendPort: sim.port,
    listenPort: 0,
    // Shorter than the defaults so each phase takes well under a second.
    pollIntervalMs: 60,
    syncQuietMs: 40,
    syncTimeoutMs: 500,
    confirmDelayMs: 20,
    confirmTimeoutMs: 300,
  });
  cleanups.push(() => conn.stop());
  const states: ConnectionState[] = [];
  conn.client.on('state', (s) => states.push(s));
  const failed: [Target, Value, string][] = [];
  conn.client.on('commandFailed', (t, v, r) => failed.push([t, v, r]));
  return { sim, conn, states, failed };
}

const live = (conn: TotalMixConnection) => () => conn.client.state === 'live';

describe('the TotalMix client against the simulator', () => {
  it('probes, syncs and goes live with the strips the simulator shows', async () => {
    const { conn, states } = await setup();
    await until(live(conn), 'live');
    expect(states).toEqual(['probing', 'syncing', 'live']);
    expect(strips(conn.store, 'input').map((s) => [s.name, s.label])).toEqual([
      ['Synth', 'AN 1/2'],
      ['Vocal', 'Mic 9'],
      ['Guitar', 'Mic 10'],
      ['Room', 'Mic 11/12'],
    ]);
    expect(mainOutput(conn.store)?.name).toBe('Main');
    expect(conn.store.value(channel('input', 8, 'phantom'))).toBe(true);
    expect(conn.transport.stats.decodeErrors).toBe(0);
  });

  it('a write is applied and confirmed by the follow-up request', async () => {
    const { sim, conn, failed } = await setup();
    await until(live(conn), 'live');
    const mute = channel('input', 8, 'mute');
    expect(conn.client.set(mute, true)).toBe(true);
    expect(conn.store.get(mute)?.state).toBe('pending');
    await until(() => conn.store.get(mute)?.state === 'confirmed', 'confirmation');
    expect(conn.store.value(mute)).toBe(true);
    expect(sim.mixer.get('/input/8/mute')).toBe(1);
    expect(failed).toEqual([]);
  });

  it('a gain write outside the preamp range is corrected by the reply', async () => {
    const { conn } = await setup();
    await until(live(conn), 'live');
    const gain = channel('input', 8, 'gain');
    conn.client.set(gain, 90);
    await until(() => conn.store.get(gain)?.state === 'confirmed', 'confirmation');
    expect(conn.store.value(gain)).toBe(75);
  });

  it('a write to a hidden channel gets no reply and is rolled back', async () => {
    const { conn, failed } = await setup();
    await until(live(conn), 'live');
    const hidden = channel('input', 4, 'mute');
    conn.client.set(hidden, true);
    await until(() => failed.length > 0, 'rollback');
    expect(failed).toEqual([[hidden, true, 'no confirmation']]);
  });

  it('Dim from the client lowers the Main volume the client sees', async () => {
    const { conn } = await setup();
    await until(live(conn), 'live');
    const volume = channel('output', 0, 'volume');
    expect(conn.store.value(volume)).toBe(-20);
    conn.client.set(controlRoom('dim'), true);
    await until(() => conn.store.value(volume) === -40, 'dimmed volume');
    await until(() => conn.store.get(controlRoom('dim'))?.state === 'confirmed', 'dim confirmed');
    expect(conn.store.value(controlRoom('dim'))).toBe(true);
  });

  it('changes made in TotalMix reach the store', async () => {
    const { sim, conn } = await setup();
    await until(live(conn), 'live');
    sim.change('/input/9/name', 'Bass');
    sim.change('/output/8/volume', -3);
    await until(() => conn.store.value(channel('output', 8, 'volume')) === -3, 'volume');
    expect(conn.store.value(channel('input', 9, 'name'))).toBe('Bass');
    expect(conn.store.value({ scope: 'snapshot', n: 1 })).toBe('modified');
  });

  it('follows a stereo pair linked and split in TotalMix', async () => {
    const { sim, conn, states } = await setup();
    await until(live(conn), 'live');
    const names = () => strips(conn.store, 'input').map((s) => [s.name, s.label]);
    const guitar = channel('input', 9, 'name');
    sim.change('/input/8/stereo', true);
    // At once one strip, then a full sync removes the right channel's old name.
    await until(() => conn.store.value(channel('input', 8, 'stereo')) === true, 'stereo');
    expect(names()).toEqual([
      ['Synth', 'AN 1/2'],
      ['Vocal', 'Mic 9/10'],
      ['Room', 'Mic 11/12'],
    ]);
    await until(() => conn.store.get(guitar) === undefined && live(conn)(), 'linked');
    // Split again: only the sync brings the right channel back.
    sim.change('/input/8/stereo', false);
    await until(() => names().length === 4 && live(conn)(), 'split');
    expect(names()).toContainEqual(['Guitar', 'Mic 10']);
    expect(states).toEqual(['probing', 'syncing', 'live', 'syncing', 'live', 'syncing', 'live']);
  });

  it('goes stale when TotalMix quits and syncs again after a restart', async () => {
    const { sim, conn, states } = await setup();
    await until(live(conn), 'live');
    await sim.quit();
    await until(() => conn.client.state === 'stale', 'stale');
    await sim.start();
    await until(live(conn), 'live again');
    expect(states).toEqual(['probing', 'syncing', 'live', 'stale', 'syncing', 'live']);
  });

  it('feeds meter levels into the store', async () => {
    const { conn } = await setup({
      meters: { signals: { 'in/8': { type: 'tone', db: -18 } }, intervalMs: 20 },
    });
    await until(live(conn), 'live');
    await until(() => conn.store.meters.has('input', 8), 'meters');
    expect(conn.store.meters.read('input', 8, performance.now()).level).toBe(-18);
  });

  it('still goes live and confirms writes with 10 % loss each way', async () => {
    const { sim, conn } = await setup({
      faults: { dropIncoming: 0.1, dropOutgoing: 0.1 },
      random: seeded(42),
    });
    await until(live(conn), 'live', 8000);
    const mute = channel('input', 9, 'mute');
    let confirmed = false;
    for (let attempt = 0; attempt < 10 && !confirmed; attempt++) {
      await until(live(conn), 'live', 8000);
      conn.client.set(mute, true);
      await until(() => conn.store.get(mute)?.state !== 'pending', 'settled', 2000);
      confirmed = conn.store.value(mute) === true;
    }
    expect(confirmed).toBe(true);
    expect(sim.faults.stats.droppedIncoming + sim.faults.stats.droppedOutgoing).toBeGreaterThan(0);
  }, 30_000);
});
