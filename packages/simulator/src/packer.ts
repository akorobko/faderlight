// Packs messages into datagrams the way TotalMix does (docs/protocol/global-osc.md §1): every
// datagram is a bundle with timetag 0, filled greedily up to 16 messages and 480 bytes. The
// capture has no datagram that the next message would still have fitted into, except where
// TotalMix starts a new one on purpose (before the snapshot states), which callers mark by
// packing those messages separately.

import { encodeMessage, type OscMessage } from '@faderlight/osc';

export const MAX_DATAGRAM_BYTES = 480;
export const MAX_DATAGRAM_MESSAGES = 16;

/** "#bundle\0" and a timetag of 0, as TotalMix sends it. */
const HEADER = new Uint8Array([
  0x23, 0x62, 0x75, 0x6e, 0x64, 0x6c, 0x65, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

function bundleOf(parts: readonly Uint8Array[]): Uint8Array {
  const size = HEADER.byteLength + parts.reduce((n, p) => n + 4 + p.byteLength, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(HEADER, 0);
  let at = HEADER.byteLength;
  for (const p of parts) {
    view.setInt32(at, p.byteLength);
    out.set(p, at + 4);
    at += 4 + p.byteLength;
  }
  return out;
}

/** Bundles of at most 16 messages and 480 bytes; a message too big for that gets its own. */
export function pack(messages: readonly OscMessage[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  let parts: Uint8Array[] = [];
  let size = HEADER.byteLength;
  for (const m of messages) {
    const bytes = encodeMessage(m);
    const grown = size + 4 + bytes.byteLength;
    if (parts.length > 0 && (grown > MAX_DATAGRAM_BYTES || parts.length >= MAX_DATAGRAM_MESSAGES)) {
      out.push(bundleOf(parts));
      parts = [];
      size = HEADER.byteLength;
    }
    parts.push(bytes);
    size += 4 + bytes.byteLength;
  }
  if (parts.length > 0) out.push(bundleOf(parts));
  return out;
}
