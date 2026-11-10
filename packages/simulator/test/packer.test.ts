import { describe, expect, it } from 'vitest';
import { decodePacket, float, isBundle, message, messagesOf, str } from '@faderlight/osc';
import { MAX_DATAGRAM_BYTES, MAX_DATAGRAM_MESSAGES, pack } from '../src/index.ts';

const short = (n: number) => message(`/input/${String(n)}/mute`, float(0));

describe('pack', () => {
  it('sends bundles with timetag 0, like TotalMix', () => {
    const [datagram] = pack([short(1)]);
    if (!datagram) throw new Error('no datagram');
    const packet = decodePacket(datagram);
    expect(isBundle(packet) && packet.timetag).toBe(0n);
    expect(messagesOf(packet)).toEqual([short(1)]);
  });

  it('fills a datagram with at most 16 messages', () => {
    const datagrams = pack(Array.from({ length: 40 }, (_, i) => short(i)));
    expect(datagrams.map((d) => messagesOf(decodePacket(d)).length)).toEqual([16, 16, 8]);
  });

  it('fills a datagram up to 480 bytes, not more', () => {
    // 40-byte elements (4-byte size + 36-byte message): 11 fit in 16 + 440 = 456 bytes, 12 not.
    const m = message('/input/1/eq/band1freq/xxxxx', float(0));
    const datagrams = pack(Array.from({ length: 25 }, () => m));
    expect(datagrams.map((d) => d.byteLength)).toEqual([456, 456, 136]);
    for (const d of datagrams) expect(d.byteLength).toBeLessThanOrEqual(MAX_DATAGRAM_BYTES);
  });

  it('keeps the order and splits only where the next message would not fit', () => {
    const messages = Array.from({ length: 100 }, (_, i) =>
      i % 3 === 0 ? message(`/input/${String(i)}/name`, str('x'.repeat(i % 30))) : short(i),
    );
    const datagrams = pack(messages);
    expect(datagrams.flatMap((d) => messagesOf(decodePacket(d)))).toEqual(messages);
    for (let i = 0; i + 1 < datagrams.length; i++) {
      const d = datagrams[i];
      const next = messagesOf(decodePacket(datagrams[i + 1] ?? new Uint8Array()))[0];
      if (!d || !next) throw new Error('missing datagram');
      const count = messagesOf(decodePacket(d)).length;
      const nextSize = pack([next])[0]?.byteLength ?? 0;
      const wouldFit = d.byteLength + nextSize - 16 <= MAX_DATAGRAM_BYTES;
      expect(count === MAX_DATAGRAM_MESSAGES || !wouldFit).toBe(true);
    }
  });

  it('gives a message too big for the limit a datagram of its own', () => {
    const big = message('/input/0/name', str('y'.repeat(600)));
    const datagrams = pack([short(0), big, short(1)]);
    expect(datagrams.map((d) => messagesOf(decodePacket(d)).length)).toEqual([1, 1, 1]);
  });

  it('sends nothing for no messages', () => {
    expect(pack([])).toEqual([]);
  });
});
