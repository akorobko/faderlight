import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodePacket,
  encodeBundle,
  encodeMessage,
  flatten,
  IMMEDIATE,
  toBase64,
} from '../src/osc.ts';
import {
  deviceLabel,
  maskBytes,
  redactedName,
  redactFile,
  serialOf,
  type Secret,
} from '../src/redact.ts';

describe('serial numbers', () => {
  it('finds the serial in a TotalMix device name', () => {
    expect(serialOf('Fireface UFX III (12345678)')).toBe('12345678');
    expect(serialOf('Fireface UFX III')).toBeUndefined();
    expect(serialOf('Fireface UFX III (XXXXXXXX)')).toBeUndefined();
    expect(serialOf('Box (12)')).toBeUndefined();
    expect(deviceLabel('Fireface UFX III (12345678)')).toBe('Fireface UFX III');
    expect(deviceLabel('Fireface UFX III (XXXXXXXX)')).toBe('Fireface UFX III');
    expect(deviceLabel('Fireface UFX III')).toBe('Fireface UFX III');
  });

  it('takes the serial out of file names', () => {
    const s: Secret[] = [{ text: '12345678', kind: 'serial number' }];
    expect(redactedName('fireface-ufx-iii-12345678-2.1-2026-11-10.jsonl', s)).toBe(
      'fireface-ufx-iii-2.1-2026-11-10.jsonl',
    );
    expect(redactedName('a12345678b.jsonl', s)).toBe('aXXXXXXXXb.jsonl');
  });
});

describe('maskBytes', () => {
  it('replaces every occurrence, ignoring ASCII case, keeping the length', () => {
    const b = new Uint8Array(Buffer.from('host BuildBox.local and buildbox.LOCAL', 'latin1'));
    expect(maskBytes(b, 'buildbox.local')).toBe(2);
    expect(Buffer.from(b).toString('latin1')).toBe('host XXXXXXXXXXXXXX and XXXXXXXXXXXXXX');
  });
});

function datagram(): Uint8Array {
  return encodeBundle(IMMEDIATE, [
    encodeMessage({ address: '/status/device', args: [['s', 'Fireface UFX III (12345678)']] }),
    encodeMessage({ address: '/status/workspace', args: [['s', '/Users/someone/ws.tmws']] }),
    encodeMessage({ address: '/input/8/name', args: [['s', 'Mic 9']] }),
  ]);
}

function captureFile(dir: string): string {
  const raw = datagram();
  const lines = [
    { k: 'meta', t: 0, format: 1, userNote: 'on BuildBox' },
    {
      k: 'rx',
      t: 5,
      from: '127.0.0.1:5000',
      size: raw.length,
      raw: toBase64(raw),
      msgs: [
        { a: '/status/device', args: [['s', 'Fireface UFX III (12345678)']] },
        { a: '/status/workspace', args: [['s', '/Users/someone/ws.tmws']] },
        { a: '/input/8/name', args: [['s', 'Mic 9']] },
      ],
    },
    { k: 'tick', t: 1000, levels: { '/level/in/0': [['f', -90]] } },
    { k: 'end', t: 2000, reason: 'done', device: 'Fireface UFX III (12345678)' },
  ];
  const file = join(dir, 'fireface-ufx-iii-12345678-2.1-2026-11-10.jsonl');
  writeFileSync(file, lines.map((l) => JSON.stringify(l) + '\n').join(''));
  return file;
}

describe('redactFile', () => {
  const extra: Secret[] = [
    { text: '/Users/someone', kind: 'home folder' },
    { text: 'someone', kind: 'user name' },
    { text: 'buildbox', kind: 'host name' },
    { text: 'ab', kind: 'too short' },
  ];

  it('masks the serial and the given names in text and raw bytes, and renames the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capture-redact-'));
    const file = captureFile(dir);
    const result = redactFile(file, extra);

    expect(result.path).toBe(join(dir, 'fireface-ufx-iii-2.1-2026-11-10.jsonl'));
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir)).toEqual(['fireface-ufx-iii-2.1-2026-11-10.jsonl']);
    const counts = Object.fromEntries(result.replaced.map((r) => [r.secret.text, r.count]));
    // Device name in the raw bytes, in msgs and in the end record.
    expect(counts['12345678']).toBe(3);
    expect(counts['/Users/someone']).toBe(2);
    expect(counts.ab).toBeUndefined();

    const text = readFileSync(result.path, 'utf8');
    for (const s of ['12345678', 'someone', 'buildbox', 'BuildBox']) expect(text).not.toContain(s);
    const records = text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(records[0]).toMatchObject({ userNote: 'on XXXXXXXX' });
    expect(records[3]).toMatchObject({ device: 'Fireface UFX III (XXXXXXXX)' });

    // The raw datagram still decodes, has the same size, and matches the decoded messages.
    const rx = records[1] as { size: number; raw: string; msgs: unknown[] };
    const bytes = new Uint8Array(Buffer.from(rx.raw, 'base64'));
    expect(bytes.length).toBe(rx.size);
    const decoded = flatten(decodePacket(bytes)).map((m) => ({
      a: m.message.address,
      args: m.message.args,
    }));
    expect(decoded).toEqual(rx.msgs);
    expect(rx.msgs).toEqual([
      { a: '/status/device', args: [['s', 'Fireface UFX III (XXXXXXXX)']] },
      { a: '/status/workspace', args: [['s', 'XXXXXXXXXXXXXX/ws.tmws']] },
      { a: '/input/8/name', args: [['s', 'Mic 9']] },
    ]);
  });

  it('changes nothing the second time', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capture-redact-'));
    const first = redactFile(captureFile(dir), extra);
    const before = readFileSync(first.path, 'utf8');
    const second = redactFile(first.path, extra);
    expect(second.path).toBe(first.path);
    expect(second.replaced.every((r) => r.count === 0)).toBe(true);
    expect(readFileSync(second.path, 'utf8')).toBe(before);
  });
});
