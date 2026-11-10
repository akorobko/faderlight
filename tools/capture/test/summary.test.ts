import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toLine, type CaptureRecord } from '../src/records.ts';
import { formatSummary, patternOf, summariseFile, Summariser } from '../src/summary.ts';

const records: CaptureRecord[] = [
  {
    k: 'step',
    t: 1,
    id: 'sendchan-input',
    phase: 'begin',
    kind: 'request',
    title: 'Request',
    sends: ['/sendchan/input/8 f:1'],
  },
  {
    k: 'rx',
    t: 2,
    from: '127.0.0.1:7002',
    size: 64,
    raw: '',
    tt: '0x0000000000000001',
    msgs: [
      { a: '/input/8/mute', args: [['f', 0]] },
      { a: '/input/8/name', args: [['s', 'Mic 9']] },
      { a: '/mix/in/8/0/fader', args: [['f', -65]] },
      { a: '/mix/in/9/3/fader', args: [['f', 0]] },
    ],
  },
  {
    k: 'step',
    t: 3,
    id: 'sendchan-input',
    phase: 'end',
    result: 'replied',
    stats: {
      ms: 2,
      rxDatagrams: 1,
      rxMessages: 4,
      meterDatagrams: 0,
      meterMessages: 0,
      addresses: 4,
      firstRxMs: 1,
      lastRxMs: 1,
    },
  },
  {
    k: 'tick',
    t: 1000,
    ms: 1000,
    rx: { datagrams: 20, messages: 400, bytes: 8000 },
    meter: { datagrams: 19, messages: 396, thinned: 19 },
    levels: { '/level/in/8': [['f', -20]] },
  },
];

describe('patternOf', () => {
  it('replaces numeric segments and keeps the indices', () => {
    expect(patternOf('/mix/in/8/0/fader')).toEqual({
      pattern: '/mix/in/{n}/{n}/fader',
      indices: [8, 0],
    });
    expect(patternOf('/sendall')).toEqual({ pattern: '/sendall', indices: [] });
  });
});

describe('Summariser', () => {
  it('groups addresses into patterns with types, ranges, examples and steps', () => {
    const sm = new Summariser();
    for (const r of records) sm.add(r);
    const s = sm.summary;
    const fader = s.patterns.get('/mix/in/{n}/{n}/fader');
    expect(fader).toMatchObject({
      count: 2,
      ranges: [
        [8, 9],
        [0, 3],
      ],
      examples: ['-65', '0'],
      steps: ['sendchan-input'],
    });
    expect([...(fader?.types ?? [])]).toEqual(['f']);
    expect(s.patterns.get('/input/{n}/name')?.examples).toEqual(['"Mic 9"']);
    expect(s.patterns.get('/level/in/{n}')).toMatchObject({ count: 0, snapshots: 1 });
    expect(s.steps[0]).toMatchObject({ id: 'sendchan-input', result: 'replied' });
    expect(s.rates.maxMsgPerSec).toBe(400);
  });

  it('reads a capture file and formats it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'capture-summary-'));
    const file = join(dir, 'x.jsonl');
    writeFileSync(file, records.map(toLine).join(''));
    const s = await summariseFile(file);
    const text = formatSummary(s, 'x.jsonl').join('\n');
    expect(text).toContain('sendchan-input');
    expect(text).toMatch(/\/mix\/in\/\{n\}\/\{n\}\/fader\s+2\s+2\s+f\s+8-9 0-3/);
    expect(text).toContain('peak rate 400 msg/s');
  });

  it('names the line of a broken file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'capture-summary-'));
    const file = join(dir, 'bad.jsonl');
    writeFileSync(file, records.slice(0, 1).map(toLine).join('') + '{oops\n');
    await expect(summariseFile(file)).rejects.toThrow(/bad\.jsonl:2/);
  });
});
