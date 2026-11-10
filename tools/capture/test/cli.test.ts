// Runs the real entry point the way a person does: `node tools/capture/src/cli.ts ...`.

import { execFile } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { CaptureRecord } from '../src/records.ts';
import { FakeTotalMix } from './fake-totalmix.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { timeout: 30_000 }, (err, stdout, stderr) => {
      const code = err === null ? 0 : typeof err.code === 'number' ? err.code : 1;
      resolve({ code, stdout, stderr });
    });
  });
}

async function freePort(): Promise<number> {
  const s = createSocket('udp4');
  await new Promise<void>((r) => {
    s.bind(0, '127.0.0.1', r);
  });
  const { port } = s.address();
  await new Promise<void>((r) => {
    s.close(() => {
      r();
    });
  });
  return port;
}

let fake: FakeTotalMix | undefined;
afterEach(async () => {
  await fake?.stop();
  fake = undefined;
});

async function startFake(device?: string): Promise<{ sendPort: string; listenPort: string }> {
  const listenPort = await freePort();
  fake = new FakeTotalMix({
    feedbackPort: listenPort,
    levelMs: 20,
    heartbeatMs: 200,
    ...(device === undefined ? {} : { device }),
  });
  await fake.start();
  return { sendPort: String(fake.port), listenPort: String(listenPort) };
}

describe('cli', () => {
  it('prints help', async () => {
    const r = await cli(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: node tools/capture/src/cli.ts <command>');
  });

  it('rejects unknown commands and bad options', async () => {
    expect((await cli(['frobnicate'])).code).toBe(2);
    expect((await cli(['run', '--meters', 'some'])).code).toBe(2);
    expect((await cli(['run', '--bogus'])).code).toBe(2);
  });

  it('lists the scripts', async () => {
    const r = await cli(['scripts']);
    expect(r.stdout).toContain('baseline');
    expect(r.stdout).toContain('sendall-2');
  });

  it('checks the connection', async () => {
    const p = await startFake();
    const r = await cli(['check', '--send-port', p.sendPort, '--listen-port', p.listenPort]);
    expect(r.stdout).toContain('device: Fake UFX');
    expect(r.code).toBe(0);
  }, 20_000);

  it('fails the check when nothing answers', async () => {
    const r = await cli(['check', '--send-port', '9', '--listen-port', String(await freePort())]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('Nothing arrived.');
  }, 20_000);

  it('runs the baseline capture unattended and writes a redacted capture file', async () => {
    const p = await startFake('Fake UFX (12345678)');
    const out = join(mkdtempSync(join(tmpdir(), 'capture-cli-')), 'run.jsonl');
    const r = await cli([
      'run',
      '--no-prompts',
      '--yes',
      '--time-scale',
      '0.05',
      '--tmfx',
      '2.10',
      '--send-port',
      p.sendPort,
      '--listen-port',
      p.listenPort,
      '--out',
      out,
    ]);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const records = readFileSync(out, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as CaptureRecord);
    expect(records[0]).toMatchObject({
      k: 'meta',
      command: 'run',
      script: 'baseline',
      tmfxVersion: '2.10',
    });
    expect(records.at(-1)).toMatchObject({
      k: 'end',
      reason: 'done',
      device: 'Fake UFX (XXXXXXXX)',
    });
    expect(r.stdout).toContain('write-mute-float');
    expect(r.stdout).toContain('Redacted serial number "12345678"');
    const text = readFileSync(out, 'utf8');
    expect(text).not.toContain('12345678');
    const rawBytes = records.flatMap((x) =>
      x.k === 'rx' || x.k === 'tx' ? [Buffer.from(x.raw, 'base64').toString('latin1')] : [],
    );
    expect(rawBytes.some((b) => b.includes('Fake UFX (XXXXXXXX)'))).toBe(true);
    expect(rawBytes.some((b) => b.includes('12345678'))).toBe(false);

    const summary = await cli(['summary', out]);
    expect(summary.code).toBe(0);
    expect(summary.stdout).toContain('/input/{n}/mute');
    const json = JSON.parse((await cli(['summary', out, '--json'])).stdout) as {
      patterns: unknown[];
    };
    expect(json.patterns.length).toBeGreaterThan(10);
  }, 30_000);
});
