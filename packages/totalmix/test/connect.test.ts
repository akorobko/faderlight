// End to end over UDP on 127.0.0.1: transport, client and store against TotalMix's recorded
// replies from the baseline capture.
import {
  channel,
  mainOutput,
  strips,
  type ConnectionState,
  type Target,
  type Value,
} from '@faderlight/model';
import { afterEach, describe, expect, it } from 'vitest';
import { connectTotalMix, type TotalMixConnection } from '../src/index.ts';
import { BASELINE, readCapture } from './capture.ts';
import { CaptureReplay } from './replay.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(): Promise<{
  replay: CaptureReplay;
  conn: TotalMixConnection;
  states: ConnectionState[];
  failed: [Target, Value, string][];
}> {
  const replay = new CaptureReplay(readCapture(BASELINE));
  await replay.start();
  cleanups.push(() => replay.stop());
  const conn = connectTotalMix({
    host: '127.0.0.1',
    sendPort: replay.port,
    listenPort: 0,
    // Shorter than the defaults so the test runs in well under a second per phase.
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
  return { replay, conn, states, failed };
}

async function until(condition: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('connectTotalMix against recorded TotalMix replies', () => {
  it('probes, syncs and goes live with the channel list TotalMix reported', async () => {
    const { replay, conn, states } = await setup();
    await until(() => conn.client.state === 'live', 'live');
    expect(states).toEqual(['probing', 'syncing', 'live']);
    expect(replay.received.slice(0, 3)).toEqual([
      '/sendstate f:1',
      '/sendall f:2',
      '/sendstate f:1',
    ]);
    expect(strips(conn.store, 'input').map((s) => s.name)).toEqual([
      'AXE FX',
      'RD 2000',
      'AN 6',
      'OC 818',
      'Guitar',
      'RE 20',
      'PC',
    ]);
    expect(mainOutput(conn.store)?.name).toBe('Main');
    expect(conn.transport.stats.decodeErrors).toBe(0);
  });

  it('corrects a write that TotalMix did not apply, from the confirming reply', async () => {
    const { replay, conn, failed } = await setup();
    await until(() => conn.client.state === 'live', 'live');
    const mute = channel('input', 8, 'mute');
    expect(conn.client.set(mute, true)).toBe(true);
    expect(conn.store.get(mute)?.state).toBe('pending');
    // The replay ignores writes and answers /sendchan/input/8 with the recorded mute 0.
    await until(() => conn.store.get(mute)?.state === 'confirmed', 'confirmation');
    expect(conn.store.value(mute)).toBe(false);
    expect(replay.received).toContain('/input/8/mute f:1');
    expect(replay.received).toContain('/sendchan/input/8 f:1');
    expect(failed).toEqual([]);
  });

  it('rolls back a write to a hidden channel (no reply at all)', async () => {
    const { conn, failed } = await setup();
    await until(() => conn.client.state === 'live', 'live');
    const hidden = channel('input', 0, 'mute');
    conn.client.set(hidden, true);
    await until(() => failed.length > 0, 'rollback');
    expect(failed).toEqual([[hidden, true, 'no confirmation']]);
    expect(conn.store.get(hidden)).toBeUndefined();
  });

  it('goes stale when TotalMix quits and syncs again when it comes back on a new port', async () => {
    const { replay, conn, states } = await setup();
    await until(() => conn.client.state === 'live', 'live');
    replay.stopAnswering();
    await until(() => conn.client.state === 'stale', 'stale');
    expect(conn.store.value(channel('input', 8, 'name'))).toBe('OC 818');
    const before = replay.sourcePort;
    await replay.restart();
    expect(replay.sourcePort).not.toBe(before);
    await until(() => conn.client.state === 'live', 'live again');
    expect(states).toEqual(['probing', 'syncing', 'live', 'stale', 'syncing', 'live']);
  });

  it('syncs again when feedback suddenly comes from a new port while live', async () => {
    const { replay, conn, states } = await setup();
    await until(() => conn.client.state === 'live', 'live');
    await replay.restart();
    replay.sendMeters(); // TotalMix's first datagram after a restart is usually a meter frame
    await until(() => states.length > 3 && conn.client.state === 'live', 'resync');
    expect(states.slice(3)).toEqual(['syncing', 'live']);
  });
});
