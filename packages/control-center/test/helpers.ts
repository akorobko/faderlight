// A Control Center host for tests: a real store and diagnostics, settings kept in memory, and
// HTTP and WebSocket clients that set the headers a browser would.

import { request } from 'node:http';
import { WebSocket } from 'ws';
import {
  DEFAULT_SETTINGS,
  readGlobalSettings,
  type GlobalSettings,
  type JsonObject,
} from '@faderlight/deck';
import { MixerStore } from '@faderlight/model';
import { Diagnostics } from '../src/diagnostics.ts';
import type { RpcNotification, RpcResponse } from '../src/protocol.ts';
import type { ControlCenterHost } from '../src/server.ts';
import type { SnapshotNameSource } from '../src/setup.ts';

export class TestHost implements ControlCenterHost {
  readonly version = '0.1.0';
  readonly store = new MixerStore();
  readonly diagnostics = new Diagnostics();
  current: GlobalSettings = DEFAULT_SETTINGS;
  saved: JsonObject[] = [];
  resyncs = 0;
  names: (string | undefined)[] = [];
  nameSource: SnapshotNameSource = 'unsupported';
  clock = 0;

  now(): number {
    return this.clock;
  }

  settings(): GlobalSettings {
    return this.current;
  }

  saveSettings(stored: JsonObject): ReturnType<typeof readGlobalSettings> {
    const read = readGlobalSettings(stored);
    this.current = read.settings;
    this.saved.push(stored);
    return read;
  }

  resync(): void {
    this.resyncs++;
  }

  snapshotNames(): { source: SnapshotNameSource; names: (string | undefined)[] } {
    return { source: this.nameSource, names: this.names };
  }
}

export interface HttpReply {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

export function get(url: string, headers: Record<string, string> = {}): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** Opens a link like a browser: returns the session cookie it was given. */
export async function login(link: string): Promise<string> {
  const reply = await get(link);
  const cookie = reply.headers['set-cookie']?.[0];
  if (reply.status !== 303 || cookie === undefined) {
    throw new Error(`login failed: ${String(reply.status)}`);
  }
  return cookie.split(';')[0] ?? '';
}

/** A JSON-RPC client over the page's WebSocket. */
export class RpcClient {
  readonly notifications: RpcNotification[] = [];
  private readonly socket: WebSocket;
  private next = 1;
  private readonly waiting = new Map<number, (r: RpcResponse) => void>();
  private watchers: {
    test: (n: RpcNotification) => boolean;
    resolve: (n: RpcNotification) => void;
  }[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (data: Buffer) => {
      const m = JSON.parse(data.toString('utf8')) as RpcResponse & RpcNotification;
      if ('id' in m && typeof m.id === 'number') {
        this.waiting.get(m.id)?.(m);
        this.waiting.delete(m.id);
        return;
      }
      this.notifications.push(m);
      this.watchers = this.watchers.filter((w) => {
        if (!w.test(m)) return true;
        w.resolve(m);
        return false;
      });
    });
  }

  static open(url: string, headers: Record<string, string>): Promise<RpcClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { headers });
      socket.once('open', () => {
        resolve(new RpcClient(socket));
      });
      socket.once('error', reject);
      socket.once('unexpected-response', (_req, res) => {
        reject(new Error(`refused: ${String(res.statusCode)}`));
      });
    });
  }

  call(method: string, params?: unknown): Promise<RpcResponse> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  raw(text: string): Promise<RpcResponse> {
    return new Promise((resolve) => {
      this.socket.once('message', (data: Buffer) => {
        resolve(JSON.parse(data.toString('utf8')) as RpcResponse);
      });
      this.socket.send(text);
    });
  }

  /** The next notification (from now on) that passes `test`. */
  waitFor(test: (n: RpcNotification) => boolean, timeoutMs = 3000): Promise<RpcNotification> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('no matching notification'));
      }, timeoutMs);
      this.watchers.push({
        test,
        resolve: (n) => {
          clearTimeout(timer);
          resolve(n);
        },
      });
    });
  }

  close(): void {
    this.socket.close();
  }
}
