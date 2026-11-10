import { createSocket, type Socket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeBundle, encodeMessage, IMMEDIATE, type OscMessage } from '../src/osc.ts';
import { Recorder, type RecorderOptions } from '../src/recorder.ts';
import { MemorySink, type CaptureRecord, type RxRecord, type TickRecord } from '../src/records.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function setup(options: Partial<RecorderOptions> = {}): Promise<{
  rec: Recorder;
  sink: MemorySink;
  send: (bytes: Uint8Array) => Promise<void>;
}> {
  const sink = new MemorySink();
  const rec = new Recorder({
    host: '127.0.0.1',
    sendPort: 9,
    listenPort: 0,
    meters: 'thin',
    meterPattern: /^\/level\//,
    maxBytes: Infinity,
    tickMs: 60_000,
    sink,
    ...options,
  });
  await rec.start();
  const sender: Socket = createSocket('udp4');
  cleanups.push(async () => {
    await rec.stop();
    await new Promise<void>((r) => {
      sender.close(() => {
        r();
      });
    });
  });
  const send = async (bytes: Uint8Array): Promise<void> => {
    const before = rec.stats.datagrams;
    await new Promise<void>((resolve, reject) => {
      sender.send(bytes, rec.port, '127.0.0.1', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    for (let n = 0; n < 100 && rec.stats.datagrams === before; n++) {
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  return { rec, sink, send };
}

const bundle = (...msgs: OscMessage[]): Uint8Array =>
  encodeBundle(IMMEDIATE, msgs.map(encodeMessage));
const level = (n: number, db: number): OscMessage => ({
  address: `/level/in/${String(n)}`,
  args: [['f', db]],
});
const rx = (records: CaptureRecord[]): RxRecord[] =>
  records.filter((r): r is RxRecord => r.k === 'rx');
const ticks = (records: CaptureRecord[]): TickRecord[] =>
  records.filter((r): r is TickRecord => r.k === 'tick');

describe('Recorder', () => {
  it('writes non-meter datagrams with raw bytes, decoded messages and the bundle timetag', async () => {
    const { rec, sink, send } = await setup();
    const packet = bundle({ address: '/input/8/mute', args: [['f', 1]] }, level(8, -20));
    await send(packet);
    const [r] = rx(sink.records);
    expect(r).toMatchObject({
      size: packet.byteLength,
      raw: Buffer.from(packet).toString('base64'),
      tt: '0x0000000000000001',
      msgs: [
        { a: '/input/8/mute', args: [['f', 1]] },
        { a: '/level/in/8', args: [['f', -20]] },
      ],
    });
    expect(r?.meter).toBeUndefined();
    expect(rec.values.get('/input/8/mute')?.args).toEqual([['f', 1]]);
    expect(rec.values.has('/level/in/8')).toBe(false);
  });

  it('thins meter-only datagrams into the next tick record', async () => {
    const { rec, sink, send } = await setup();
    await send(bundle(level(0, -90), level(1, -40)));
    await send(bundle(level(0, -80)));
    await rec.stop();
    expect(rx(sink.records)).toHaveLength(0);
    const tick = ticks(sink.records).at(-1);
    expect(tick?.meter).toEqual({ datagrams: 2, messages: 3, thinned: 2 });
    expect(tick?.levels).toEqual({ '/level/in/0': [['f', -80]], '/level/in/1': [['f', -40]] });
    expect(rec.stats.thinned).toBe(2);
  });

  it('records meters in full while a step asks for it', async () => {
    const { rec, sink, send } = await setup();
    rec.setFullMeters(true);
    await send(bundle(level(0, -90)));
    rec.setFullMeters(false);
    await send(bundle(level(0, -90)));
    expect(rx(sink.records).map((r) => r.meter)).toEqual([true]);
  });

  it('stops writing meter datagrams over the size cap and says so once', async () => {
    const { sink, send } = await setup({ meters: 'full', maxBytes: 1 });
    await send(bundle({ address: '/status/device', args: [['s', 'X']] }));
    await send(bundle(level(0, -90)));
    await send(bundle(level(0, -90)));
    expect(rx(sink.records)).toHaveLength(1);
    expect(sink.records.filter((r) => r.k === 'note' && r.level === 'warn')).toHaveLength(1);
  });

  it('treats addresses added as high-rate like meters', async () => {
    const { rec, sink, send } = await setup();
    rec.addMeterAddresses(['/peak/in/0']);
    await send(bundle({ address: '/peak/in/0', args: [['f', -3]] }));
    expect(rx(sink.records)).toHaveLength(0);
    expect(rec.isMeter('/peak/in/0')).toBe(true);
  });

  it('keeps undecodable datagrams with the error', async () => {
    const { sink, send } = await setup();
    await send(new Uint8Array([0x2f, 0x78, 0, 0, 0x2c, 0x71, 0, 0]));
    expect(rx(sink.records)[0]).toMatchObject({
      raw: 'L3gAACxxAAA=',
      error: expect.stringMatching(/unknown type tag/) as unknown,
    });
  });

  it('attributes traffic to the current step', async () => {
    const { rec, sink, send } = await setup();
    rec.beginStep('s1', 'request', 'Step one', { why: 'because', sends: ['/x f:1'] });
    await send(bundle({ address: '/a', args: [['i', 1]] }, { address: '/b', args: [] }));
    const stats = rec.endStep('replied');
    expect(stats).toMatchObject({ rxDatagrams: 1, rxMessages: 2, addresses: 2 });
    expect(sink.records.filter((r) => r.k === 'step')).toMatchObject([
      { id: 's1', phase: 'begin', why: 'because', sends: ['/x f:1'] },
      { id: 's1', phase: 'end', result: 'replied' },
    ]);
  });

  it('explains a busy port', async () => {
    const { rec } = await setup();
    const second = new Recorder({ ...rec.options, listenPort: rec.port, sink: new MemorySink() });
    await expect(second.start()).rejects.toThrow(/already in use/);
  });
});
