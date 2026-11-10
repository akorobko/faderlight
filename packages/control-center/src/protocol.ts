// The Control Center's JSON-RPC 2.0 protocol over its WebSocket (`/rpc`): the methods the page
// calls and the notifications the server pushes for the topics it subscribed to. Shared by the
// server (server.ts) and the page (ui/), so both sides agree on the shapes. Types only, apart
// from a few constants: the page must not pull Node code into its bundle.
//
// JSON has no -Infinity (an output that is off): values that are not finite numbers travel as
// the strings "-Infinity", "Infinity" and "NaN" (encodeJson/decodeJson).

import type { GlobalSettings, JsonObject } from '@faderlight/deck';
import type { EntryState, Target } from '@faderlight/model';
import type { ConnectionReport, PacketEntry } from './diagnostics.ts';
import type { SetupCheck } from './setup.ts';
import type { MeterTuple, MixerSummary } from './summary.ts';

export const RPC_PATH = '/rpc';

/** What can be followed live. */
export type Topic = 'settings' | 'mixer' | 'meters' | 'connection' | 'packets' | 'store';

export const TOPICS: readonly Topic[] = [
  'settings',
  'mixer',
  'meters',
  'connection',
  'packets',
  'store',
];

export interface HelloResult {
  /** The plugin's version. */
  readonly version: string;
  readonly settings: GlobalSettings;
  readonly defaults: GlobalSettings;
}

export interface SaveResult {
  /** The settings as kept: checked, clamped and completed. */
  readonly settings: GlobalSettings;
  /** Fields that had no valid value, e.g. "gestures.longPressMs: 5 is below 200". */
  readonly problems: readonly string[];
}

export interface StoreEntryJson {
  readonly key: string;
  readonly target: Target;
  readonly value: number | boolean | string;
  readonly state: EntryState;
}

export interface Methods {
  hello: { params: undefined; result: HelloResult };
  'settings.save': { params: { readonly settings: JsonObject }; result: SaveResult };
  subscribe: { params: { readonly topics: readonly Topic[] }; result: null };
  unsubscribe: { params: { readonly topics: readonly Topic[] }; result: null };
  /** Reads the whole mixer again. */
  'mixer.resync': { params: undefined; result: null };
  'packets.clear': { params: undefined; result: null };
  /** Keep meter messages in the packet log too (many: off by default). */
  'packets.meters': { params: { readonly on: boolean }; result: null };
}

export type Method = keyof Methods;

export interface Notifications {
  settings: GlobalSettings;
  mixer: MixerSummary;
  /** By "bus/index". */
  meters: Readonly<Record<string, MeterTuple>>;
  connection: { readonly report: ConnectionReport; readonly checks: readonly SetupCheck[] };
  /** reset: the entries replace what the page has (the first message, or after a clear). */
  packets: {
    readonly reset: boolean;
    readonly entries: readonly PacketEntry[];
    readonly meters: boolean;
  };
  /** reset: `set` is the whole store. */
  store: {
    readonly reset: boolean;
    readonly set: readonly StoreEntryJson[];
    readonly removed: readonly string[];
  };
}

export interface RpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly method: string;
  readonly params?: unknown;
}

export interface RpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

export interface RpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params: unknown;
}

/** JSON-RPC error codes. */
export const RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  server: -32000,
} as const;

/** JSON text of a value, with non-finite numbers as strings. */
export function encodeJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'number' && !Number.isFinite(v) ? String(v) : v,
  );
}

/** The value of a store entry as it arrived: "-Infinity" back to a number. */
export function decodeNumber(v: unknown): unknown {
  if (v === '-Infinity') return -Infinity;
  if (v === 'Infinity') return Infinity;
  if (v === 'NaN') return NaN;
  return v;
}
