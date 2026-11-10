// OSC 1.0 data model: arguments, messages, bundles.
// Spec: https://opensoundcontrol.stanford.edu/spec-1_0.html
//
// Arrays (`[` `]`) are not supported: nothing we talk to sends them.

export type OscArg =
  | { readonly type: 'i'; readonly value: number }
  | { readonly type: 'f'; readonly value: number }
  | { readonly type: 'd'; readonly value: number }
  | { readonly type: 'h'; readonly value: bigint }
  | { readonly type: 't'; readonly value: bigint }
  | { readonly type: 's'; readonly value: string }
  | { readonly type: 'S'; readonly value: string }
  | { readonly type: 'c'; readonly value: string }
  | { readonly type: 'r'; readonly value: number }
  | { readonly type: 'm'; readonly value: Uint8Array }
  | { readonly type: 'b'; readonly value: Uint8Array }
  | { readonly type: 'T' }
  | { readonly type: 'F' }
  | { readonly type: 'N' }
  | { readonly type: 'I' };

export type OscTypeTag = OscArg['type'];

export interface OscMessage {
  readonly address: string;
  readonly args: readonly OscArg[];
}

export interface OscBundle {
  /** NTP timetag: seconds since 1900 in the high 32 bits, fraction in the low 32 bits. */
  readonly timetag: bigint;
  readonly elements: readonly OscPacket[];
}

export type OscPacket = OscMessage | OscBundle;

/** Timetag 1: "immediately" in OSC 1.0. (TotalMix itself sends 0.) */
export const IMMEDIATELY = 1n;

export function isBundle(packet: OscPacket): packet is OscBundle {
  return 'elements' in packet;
}

// --- constructors ---------------------------------------------------------------------

export const int = (value: number): OscArg => ({ type: 'i', value });
export const float = (value: number): OscArg => ({ type: 'f', value });
export const double = (value: number): OscArg => ({ type: 'd', value });
export const str = (value: string): OscArg => ({ type: 's', value });
export const blob = (value: Uint8Array): OscArg => ({ type: 'b', value });
export const TRUE: OscArg = { type: 'T' };
export const FALSE: OscArg = { type: 'F' };

export function message(address: string, ...args: OscArg[]): OscMessage {
  return { address, args };
}

export function bundle(elements: readonly OscPacket[], timetag: bigint = IMMEDIATELY): OscBundle {
  return { timetag, elements };
}

// --- readers --------------------------------------------------------------------------

/** Numeric reading of an argument: i, f, d as is, T as 1, F as 0. Otherwise undefined. */
export function argNumber(arg: OscArg | undefined): number | undefined {
  switch (arg?.type) {
    case 'i':
    case 'f':
    case 'd':
      return arg.value;
    case 'T':
      return 1;
    case 'F':
      return 0;
    default:
      return undefined;
  }
}

/** String reading of an argument (s or S), otherwise undefined. */
export function argString(arg: OscArg | undefined): string | undefined {
  return arg?.type === 's' || arg?.type === 'S' ? arg.value : undefined;
}

/** Every message in a packet, bundles flattened depth-first in order. */
export function messagesOf(packet: OscPacket): OscMessage[] {
  if (!isBundle(packet)) return [packet];
  const out: OscMessage[] = [];
  const walk = (p: OscPacket): void => {
    if (isBundle(p)) for (const e of p.elements) walk(e);
    else out.push(p);
  };
  walk(packet);
  return out;
}

/** One-line form for logs and test names, e.g. `/input/8/mute f:1`. */
export function formatMessage(msg: OscMessage): string {
  const args = msg.args.map((a) => {
    switch (a.type) {
      case 's':
      case 'S':
      case 'c':
        return `${a.type}:${JSON.stringify(a.value)}`;
      case 'b':
      case 'm':
        return `${a.type}:<${String(a.value.byteLength)} bytes>`;
      case 'T':
      case 'F':
      case 'N':
      case 'I':
        return a.type;
      default:
        return `${a.type}:${String(a.value)}`;
    }
  });
  return [msg.address, ...args].join(' ');
}
