import { afterEach, describe, expect, it } from 'vitest';
import { CaptureReplayer, readCapture, replayedDatagrams } from '../src/index.ts';
import { BASELINE, Listener } from './helpers.ts';

const capture = readCapture(BASELINE);

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('replayedDatagrams', () => {
  it('selects by step and leaves meters out on request', () => {
    const all = replayedDatagrams(capture);
    expect(all).toHaveLength(capture.received.length);
    const noMeters = replayedDatagrams(capture, { meters: false });
    expect(noMeters.length).toBeLessThan(all.length);
    expect(noMeters.every((d) => !d.meter)).toBe(true);
    const dim = replayedDatagrams(capture, { steps: ['ui-dim'], meters: false });
    expect(dim.map((d) => d.messages.map((m) => m.address))).toEqual([
      [
        '/level/in/8',
        '/level/in/9',
        '/level/in/11',
        '/level/out/0',
        '/level/out/1',
        '/output/2/volume',
        '/controlroom/dim',
      ],
      ['/level/in/2', '/level/in/3', '/level/in/11', '/output/2/volume', '/controlroom/dim'],
    ]);
  });
});

describe('CaptureReplayer', () => {
  it('sends the recorded bytes in order, with a new source port where TotalMix restarted', async () => {
    const client = new Listener();
    await client.start();
    cleanups.push(() => client.stop());
    const steps = ['ui-dim', 'restart', 'after-restart'];
    const replay = new CaptureReplayer(capture, {
      port: client.port,
      speed: 1000,
      meters: false,
      steps,
    });
    cleanups.push(() => replay.stop());
    const expected = replayedDatagrams(capture, { meters: false, steps });
    const startedAt = performance.now();
    await replay.start();
    await replay.done;
    const elapsed = performance.now() - startedAt;
    const span = ((expected.at(-1)?.t ?? 0) - (expected[0]?.t ?? 0)) / 1000;
    expect(elapsed).toBeGreaterThanOrEqual(span - 5);

    while (client.received.length < expected.length) await new Promise((r) => setTimeout(r, 5));
    expect(client.received.map((r) => r.size)).toEqual(expected.map((d) => d.raw.byteLength));
    // Two TotalMix sender ports in the recording, two local ports in the replay.
    expect(new Set(expected.map((d) => d.peer)).size).toBe(2);
    expect(replay.sourcePorts).toHaveLength(2);
    const ports = client.received.map((r) => r.from);
    const peers = expected.map((d) => d.peer);
    for (let i = 1; i < ports.length; i++) {
      expect(ports[i] === ports[i - 1]).toBe(peers[i] === peers[i - 1]);
    }
  });

  it('rejects a speed of 0', () => {
    expect(() => new CaptureReplayer(capture, { port: 9, speed: 0 })).toThrow(RangeError);
  });
});
