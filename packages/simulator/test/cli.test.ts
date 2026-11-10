import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSimulator,
  parseCommandLine,
  runCommand,
  seededRandom,
  type RunOptions,
} from '../src/cli.ts';
import { BASELINE, Listener, req, until } from './helpers.ts';

const CLI = join(import.meta.dirname, '../src/cli.ts');

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function runOptions(argv: string[]): RunOptions {
  const parsed = parseCommandLine(argv);
  if (parsed.command !== 'run') throw new Error(`expected run, got ${parsed.command}`);
  return parsed.options;
}

describe('parseCommandLine', () => {
  it('defaults to TotalMix ports, the studio layout and studio meters', () => {
    expect(runOptions([])).toEqual({
      portIn: 7002,
      portOut: 9002,
      host: '127.0.0.1',
      bind: '127.0.0.1',
      profile: 'ufx3',
      layout: 'studio',
      state: undefined,
      meters: 'studio',
      replyDelayMs: 8,
      faults: {
        dropIncoming: 0,
        dropOutgoing: 0,
        latencyMs: 0,
        jitterMs: 0,
        bandwidthBytesPerSec: 0,
      },
      seed: undefined,
    });
  });

  it('reads ports, layout, meters and faults', () => {
    const o = runOptions([
      'run',
      '--port-in=7010',
      '--port-out',
      '9010',
      '--layout',
      'full',
      '--meters',
      'clip',
      '--drop-out',
      '0.2',
      '--latency',
      '15',
      '--seed',
      '9',
    ]);
    expect([o.portIn, o.portOut, o.layout, o.meters, o.seed]).toEqual([
      7010,
      9010,
      'full',
      'clip',
      9,
    ]);
    expect(o.faults.dropOutgoing).toBe(0.2);
    expect(o.faults.latencyMs).toBe(15);
    expect(runOptions(['--no-meters']).meters).toBe('off');
  });

  it('reads replay options', () => {
    expect(
      parseCommandLine([
        'replay',
        'x.jsonl',
        '--speed',
        '4',
        '--no-meters',
        '--steps',
        'ui-mute, ui-dim',
      ]),
    ).toEqual({
      command: 'replay',
      options: {
        file: 'x.jsonl',
        portOut: 9002,
        host: '127.0.0.1',
        speed: 4,
        meters: false,
        steps: ['ui-mute', 'ui-dim'],
      },
    });
  });

  it('rejects bad input with a message', () => {
    for (const argv of [
      ['--port-in', '70000'],
      ['--port-in', 'x'],
      ['--layout', 'huge'],
      ['--drop-in', '2'],
      ['replay'],
      ['jump'],
    ]) {
      expect(() => parseCommandLine(argv), argv.join(' ')).toThrow();
    }
    expect(parseCommandLine(['-h'])).toEqual({ command: 'help' });
  });
});

describe('seededRandom', () => {
  it('repeats for the same seed and stays in [0, 1)', () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('runCommand', () => {
  const sim = createSimulator(runOptions(['--port-in', '0', '--meters', 'off']));

  it('sets and gets values', async () => {
    expect(await runCommand(sim, 'set /input/8/mute 1')).toBe('sent');
    expect(await runCommand(sim, 'set /input/8/mute 1')).toBe('unchanged');
    expect(await runCommand(sim, 'get /input/8/mute')).toBe('/input/8/mute 1');
    expect(await runCommand(sim, 'set /input/8/name "Lead vox"')).toBe('sent');
    expect(sim.mixer.get('/input/8/name')).toBe('Lead vox');
    expect(await runCommand(sim, 'set /input/8/pfl 1')).toBe('no such address: /input/8/pfl');
  });

  it('loads snapshots, changes faults, levels and speed', async () => {
    expect(await runCommand(sim, 'snapshot 2')).toBe('loaded snapshot 2');
    expect(sim.mixer.get('/snapshot/load/2')).toBe(2);
    expect(await runCommand(sim, 'faults dropOut=0.5 latency=20')).toMatch(/^faults /);
    expect(sim.faults.options).toMatchObject({ dropOutgoing: 0.5, latencyMs: 20 });
    expect(await runCommand(sim, 'faults dropOut=3')).toMatch(/between 0 and 1/);
    expect(await runCommand(sim, 'levels off')).toBe('levels off');
    expect(sim.levelsOn).toBe(false);
    expect(await runCommand(sim, 'speed double')).toBe('speed double: 54 channels per bus');
    expect(await runCommand(sim, 'signal in/8 noise -12')).toBe('in/8: noise');
    expect(await runCommand(sim, 'jump')).toMatch(/unknown command/);
    expect(await runCommand(sim, 'help')).toMatch(/^Commands:/);
  });

  it('can start from the state of a capture', () => {
    const fromCapture = createSimulator(runOptions(['--state', BASELINE]));
    expect(fromCapture.mixer.strips('input')).toEqual([2, 4, 5, 8, 10, 11, 14]);
    expect(fromCapture.mixer.get('/controlroom/mainout')).toBe(2);
  });
});

describe('the CLI process', () => {
  it('serves requests and exits on "exit"', async () => {
    const client = new Listener();
    await client.start();
    cleanups.push(() => client.stop());
    const child = spawn(
      process.execPath,
      [CLI, '--port-in', '0', '--port-out', String(client.port), '--meters', 'off'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    cleanups.push(() => {
      child.kill();
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    await until(() => /requests on 127\.0\.0\.1:\d+/.test(out), 'the banner', 10_000);
    const port = Number(/requests on 127\.0\.0\.1:(\d+)/.exec(out)?.[1]);
    client.send(port, req('/sendstate'));
    await until(() => client.texts().includes('/status/connection f:1'), 'a reply');
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    child.stdin.write('exit\n');
    expect(await exited).toBe(0);
  }, 20_000);
});
