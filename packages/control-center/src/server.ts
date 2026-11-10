// The Control Center server: a small HTTP + WebSocket server inside the plugin that serves the
// Control Center page and answers it over JSON-RPC (protocol.ts). It knows nothing of the
// Stream Deck SDK; the plugin (and the virtual deck) give it a ControlCenterHost.
//
// Only this computer can reach it, and only through a link the plugin hands out:
// - it listens on 127.0.0.1, on a port the system picks;
// - link() makes a one-time token (valid for two minutes). Opening the link swaps the token
//   for a session cookie (HttpOnly, SameSite=Strict) and drops it from the address bar;
//   every other request needs that cookie;
// - requests must name this server in their Host header (no DNS rebinding), and the
//   WebSocket must come from the page itself (Origin), so other web pages cannot use it.

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, relative, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  DEFAULT_SETTINGS,
  SILENT,
  type GlobalSettings,
  type JsonObject,
  type Logger,
  type ReadSettings,
  type SnapshotNameRead,
} from '@faderlight/deck';
import { DARK } from '@faderlight/render';
import { keyOf, type Key, type MixerStore } from '@faderlight/model';
import type { Diagnostics } from './diagnostics.ts';
import {
  encodeJson,
  RPC_ERRORS,
  RPC_PATH,
  TOPICS,
  type HelloResult,
  type Method,
  type Methods,
  type Notifications,
  type RpcRequest,
  type SaveResult,
  type StoreEntryJson,
  type Topic,
} from './protocol.ts';
import { setupChecks } from './setup.ts';
import { meterFrame, mixerSummary } from './summary.ts';

/** What the Control Center needs from the plugin. */
export interface ControlCenterHost {
  /** The plugin's version. */
  readonly version: string;
  readonly store: MixerStore;
  readonly diagnostics: Diagnostics;
  /** Now, on the clock the meters are stamped with. */
  now(): number;
  settings(): GlobalSettings;
  /** Checks, applies and stores new global settings; returns what was kept. */
  saveSettings(stored: JsonObject): ReadSettings;
  /** Reads the whole mixer again. */
  resync(): void;
  /** Snapshot names from TotalMix's state file (index 0: snapshot 1), and where they came from. */
  snapshotNames(): SnapshotNameRead;
}

export interface UiFile {
  readonly type: string;
  readonly body: string | Uint8Array;
}

/** The page's files by path ("/index.html", "/app.js"). */
export type UiFiles = ReadonlyMap<string, UiFile>;

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.map': 'application/json',
};

/** Reads a built page folder (the plugin's control-center/) into memory. */
export function readUiFiles(dir: string): UiFiles {
  const files = new Map<string, UiFile>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        const url = `/${relative(dir, path).split(sep).join('/')}`;
        files.set(url, {
          type: TYPES[extname(name)] ?? 'application/octet-stream',
          body: readFileSync(path),
        });
      }
    }
  };
  walk(dir);
  return files;
}

export interface ControlCenterOptions {
  readonly host: ControlCenterHost;
  readonly files: UiFiles;
  readonly log?: Logger;
  /** Port to listen on (default 0: one the system picks). */
  readonly port?: number;
  /** A link works this long (default 2 minutes). */
  readonly linkTtlMs?: number;
  /** Wall clock, for links (default Date.now). */
  readonly clock?: () => number;
}

/** How often live topics are sent: meters 10 times a second, the mixer up to 5. */
const TICK_MS = 100;
const MIXER_EVERY_MS = 200;
const CONNECTION_EVERY_MS = 1000;

interface Client {
  readonly socket: WebSocket;
  readonly topics: Set<Topic>;
  /** Last packet log entry sent. */
  packetsSent: number;
}

const token = (): string => randomBytes(24).toString('base64url');

export class ControlCenterServer {
  private readonly host: ControlCenterHost;
  private readonly files: UiFiles;
  private readonly log: Logger;
  private readonly linkTtlMs: number;
  private readonly clock: () => number;
  private readonly requestedPort: number;
  private readonly server: Server;
  private readonly wss: WebSocketServer;
  /** One-time tokens and when they expire. */
  private readonly links = new Map<string, number>();
  private readonly sessions = new Set<string>();
  private readonly clients = new Set<Client>();
  private ticker: NodeJS.Timeout | undefined;
  private unsubscribeStore: (() => void) | undefined;
  private changedKeys = new Set<Key>();
  private mixerDirty = true;
  private lastMixer = '';
  private lastMixerAt = 0;
  private lastConnectionAt = 0;
  private lastSettings = '';
  private listening = false;

  constructor(options: ControlCenterOptions) {
    this.host = options.host;
    this.files = options.files;
    this.log = options.log ?? SILENT;
    this.linkTtlMs = options.linkTtlMs ?? 120_000;
    this.clock = options.clock ?? Date.now;
    this.requestedPort = options.port ?? 0;
    this.server = createServer((req, res) => {
      this.request(req, res);
    });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
    this.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      this.upgrade(req, socket, head);
    });
  }

  get port(): number {
    const a = this.server.address() as AddressInfo | null;
    return a?.port ?? 0;
  }

  get running(): boolean {
    return this.listening;
  }

  /** The page's address, without a token: it only works in a browser that has a session. */
  get origin(): string {
    return `http://127.0.0.1:${String(this.port)}`;
  }

  async start(): Promise<void> {
    if (this.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.requestedPort, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    this.listening = true;
    this.unsubscribeStore = this.host.store.subscribe((change) => {
      for (const k of change.keys) this.changedKeys.add(k);
      this.mixerDirty = true;
    });
    this.ticker = setInterval(() => {
      this.tick();
    }, TICK_MS);
    this.ticker.unref();
    this.log.info(`Control Center on ${this.origin}`);
  }

  async stop(): Promise<void> {
    if (!this.listening) return;
    this.listening = false;
    clearInterval(this.ticker);
    this.ticker = undefined;
    this.unsubscribeStore?.();
    for (const c of this.clients) c.socket.terminate();
    this.clients.clear();
    await new Promise<void>((resolve) => {
      this.wss.close(() => {
        resolve();
      });
    });
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
      this.server.closeAllConnections();
    });
  }

  /**
   * A link that opens the Control Center once, e.g. http://127.0.0.1:52123/?t=…#layout.
   * `section` is the page to show (connection, channels, layout, behaviour, appearance, backup).
   */
  link(section?: string): string {
    const now = this.clock();
    for (const [t, until] of this.links) if (until <= now) this.links.delete(t);
    const t = token();
    this.links.set(t, now + this.linkTtlMs);
    return `${this.origin}/?t=${t}${section ? `#${encodeURIComponent(section)}` : ''}`;
  }

  /** The global settings changed elsewhere (the Stream Deck app): tell the open pages. */
  settingsChanged(): void {
    this.pushSettings();
  }

  // --- HTTP ---------------------------------------------------------------------------------

  private allowedHost(req: IncomingMessage): boolean {
    const port = String(this.port);
    return req.headers.host === `127.0.0.1:${port}` || req.headers.host === `localhost:${port}`;
  }

  private cookieName(): string {
    return `faderlight_${String(this.port)}`;
  }

  private session(req: IncomingMessage): boolean {
    const name = this.cookieName();
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [k, v] = part.trim().split('=');
      if (k === name && v !== undefined && this.sessions.has(v)) return true;
    }
    return false;
  }

  private request(req: IncomingMessage, res: ServerResponse): void {
    if (!this.allowedHost(req)) {
      deny(res, 421, 'This server only answers to its own address.');
      return;
    }
    const url = new URL(req.url ?? '/', this.origin);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET' });
      res.end();
      return;
    }
    const t = url.searchParams.get('t');
    if (t !== null) {
      const until = this.links.get(t);
      this.links.delete(t);
      if (until !== undefined && until > this.clock()) {
        const id = token();
        this.sessions.add(id);
        res.writeHead(303, {
          location: '/',
          'set-cookie': `${this.cookieName()}=${id}; Path=/; HttpOnly; SameSite=Strict`,
          'cache-control': 'no-store',
        });
        res.end();
        return;
      }
      if (this.session(req)) {
        // An old link, opened again in a browser that already has a session.
        res.writeHead(303, { location: '/', 'cache-control': 'no-store' });
        res.end();
        return;
      }
      deny(
        res,
        403,
        'This link has already been used or has expired. Open the Control Center from the Stream Deck again: press the Status key, or Open Control Center in a key’s settings.',
      );
      return;
    }
    if (!this.session(req)) {
      deny(
        res,
        403,
        'Open the Control Center from the Stream Deck: press the Status key, or Open Control Center in a key’s settings.',
      );
      return;
    }
    const file = this.files.get(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': file.type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': this.csp(),
    });
    res.end(req.method === 'HEAD' ? undefined : file.body);
  }

  private csp(): string {
    const port = String(this.port);
    return [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      `connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}`,
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ');
  }

  // --- WebSocket ----------------------------------------------------------------------------

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const port = String(this.port);
    const origin = req.headers.origin;
    const ok =
      this.allowedHost(req) &&
      new URL(req.url ?? '/', this.origin).pathname === RPC_PATH &&
      (origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`) &&
      this.session(req);
    if (!ok) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.connect(ws);
    });
  }

  private connect(socket: WebSocket): void {
    const client: Client = { socket, topics: new Set(), packetsSent: 0 };
    this.clients.add(client);
    socket.on('message', (data: RawData) => {
      this.message(client, data);
    });
    socket.on('close', () => {
      this.clients.delete(client);
    });
    socket.on('error', (e) => {
      this.log.debug('Control Center socket:', e);
    });
  }

  private send(client: Client, message: unknown): void {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(encodeJson(message));
  }

  private notify<T extends Topic>(client: Client, topic: T, params: Notifications[T]): void {
    this.send(client, { jsonrpc: '2.0', method: topic, params });
  }

  private message(client: Client, data: RawData): void {
    let request: Partial<Record<keyof RpcRequest, unknown>>;
    try {
      request = JSON.parse(rawText(data)) as Partial<Record<keyof RpcRequest, unknown>>;
    } catch {
      this.send(client, {
        jsonrpc: '2.0',
        id: null,
        error: { code: RPC_ERRORS.parse, message: 'not JSON' },
      });
      return;
    }
    const id = typeof request.id === 'number' || typeof request.id === 'string' ? request.id : null;
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string' || id === null) {
      this.send(client, {
        jsonrpc: '2.0',
        id,
        error: { code: RPC_ERRORS.invalidRequest, message: 'expected a JSON-RPC 2.0 request' },
      });
      return;
    }
    try {
      const result = this.call(client, request.method, request.params);
      this.send(client, { jsonrpc: '2.0', id, result });
    } catch (e) {
      const error =
        e instanceof RpcError
          ? { code: e.code, message: e.message }
          : { code: RPC_ERRORS.server, message: e instanceof Error ? e.message : String(e) };
      if (!(e instanceof RpcError)) this.log.error(`Control Center: ${request.method} failed:`, e);
      this.send(client, { jsonrpc: '2.0', id, error });
    }
  }

  private call(client: Client, method: string, params: unknown): unknown {
    const handler = (
      this.methods as Record<string, ((c: Client, p: unknown) => unknown) | undefined>
    )[method];
    if (!handler) throw new RpcError(RPC_ERRORS.methodNotFound, `no method ${method}`);
    return handler(client, params);
  }

  private readonly methods: {
    readonly [M in Method]: (client: Client, params: unknown) => Methods[M]['result'];
  } = {
    hello: (): HelloResult => ({
      version: this.host.version,
      settings: this.host.settings(),
      defaults: DEFAULT_SETTINGS,
      palette: Object.fromEntries(
        Object.entries(DARK.channelColors).flatMap(([n, hex]) => (hex ? [[n, hex]] : [])),
      ),
    }),
    'settings.save': (_c, params): SaveResult => {
      const settings = objectParam(params, 'settings');
      const read = this.host.saveSettings(settings);
      this.pushSettings();
      return { settings: read.settings, problems: read.problems };
    },
    subscribe: (client, params) => {
      // A topic the client follows already gets its first message again: the page has a new
      // listener for it (a section opened from the navigation) that needs everything there is.
      for (const topic of topicsParam(params)) {
        client.topics.add(topic);
        this.first(client, topic);
      }
      return null;
    },
    unsubscribe: (client, params) => {
      for (const topic of topicsParam(params)) client.topics.delete(topic);
      return null;
    },
    'mixer.resync': () => {
      this.host.resync();
      return null;
    },
    'packets.clear': () => {
      this.host.diagnostics.log.clear();
      for (const c of this.clients) {
        if (c.topics.has('packets')) this.first(c, 'packets');
      }
      return null;
    },
    'packets.meters': (_c, params) => {
      const on = (params as { on?: unknown } | undefined)?.on;
      if (typeof on !== 'boolean') throw new RpcError(RPC_ERRORS.invalidParams, 'expected {on}');
      this.host.diagnostics.log.meters = on;
      return null;
    },
  };

  // --- topics -------------------------------------------------------------------------------

  /** The first message of a topic a client just subscribed to: everything there is. */
  private first(client: Client, topic: Topic): void {
    switch (topic) {
      case 'settings':
        this.notify(client, 'settings', this.host.settings());
        return;
      case 'mixer':
        this.notify(client, 'mixer', this.summary());
        return;
      case 'meters':
        this.notify(client, 'meters', meterFrame(this.host.store, this.host.now()));
        return;
      case 'connection':
        this.notify(client, 'connection', this.connection());
        return;
      case 'packets': {
        const log = this.host.diagnostics.log;
        client.packetsSent = log.last;
        this.notify(client, 'packets', { reset: true, entries: log.since(0), meters: log.meters });
        return;
      }
      case 'store':
        this.notify(client, 'store', {
          reset: true,
          set: [...this.host.store.entries()].map((e) => ({
            key: keyOf(e.target),
            target: e.target,
            value: e.value,
            state: e.state,
          })),
          removed: [],
        });
        return;
    }
  }

  private summary(): Notifications['mixer'] {
    return mixerSummary(this.host.store, this.host.snapshotNames().names);
  }

  private connection(): Notifications['connection'] {
    const report = this.host.diagnostics.report(this.host.store);
    return { report, checks: setupChecks(report, this.host.snapshotNames().source) };
  }

  private subscribers(topic: Topic): Client[] {
    return [...this.clients].filter((c) => c.topics.has(topic));
  }

  private pushSettings(): void {
    const settings = this.host.settings();
    const text = JSON.stringify(settings);
    if (text === this.lastSettings) return;
    this.lastSettings = text;
    for (const c of this.subscribers('settings')) this.notify(c, 'settings', settings);
  }

  private tick(): void {
    if (this.clients.size === 0) {
      this.changedKeys.clear();
      return;
    }
    const now = this.clock();

    const store = this.subscribers('store');
    if (this.changedKeys.size > 0) {
      if (store.length > 0) {
        const set: StoreEntryJson[] = [];
        const removed: string[] = [];
        for (const key of this.changedKeys) {
          const e = this.host.store.getKey(key);
          if (e) set.push({ key, target: e.target, value: e.value, state: e.state });
          else removed.push(key);
        }
        for (const c of store) this.notify(c, 'store', { reset: false, set, removed });
      }
      this.changedKeys.clear();
    }

    if (this.mixerDirty && now - this.lastMixerAt >= MIXER_EVERY_MS) {
      this.mixerDirty = false;
      this.lastMixerAt = now;
      const mixer = this.subscribers('mixer');
      if (mixer.length > 0) {
        const summary = this.summary();
        const text = JSON.stringify(summary);
        if (text !== this.lastMixer) {
          this.lastMixer = text;
          for (const c of mixer) this.notify(c, 'mixer', summary);
        }
      }
    }

    const meters = this.subscribers('meters');
    if (meters.length > 0) {
      const frame = meterFrame(this.host.store, this.host.now());
      for (const c of meters) this.notify(c, 'meters', frame);
    }

    if (now - this.lastConnectionAt >= CONNECTION_EVERY_MS) {
      this.lastConnectionAt = now;
      const connection = this.subscribers('connection');
      if (connection.length > 0) {
        const report = this.connection();
        for (const c of connection) this.notify(c, 'connection', report);
      }
    }

    const log = this.host.diagnostics.log;
    for (const c of this.subscribers('packets')) {
      if (log.last <= c.packetsSent) continue;
      const entries = log.since(c.packetsSent);
      c.packetsSent = log.last;
      if (entries.length > 0) {
        this.notify(c, 'packets', { reset: false, entries, meters: log.meters });
      }
    }
  }
}

class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function objectParam(params: unknown, name: string): JsonObject {
  const v = (params as Record<string, unknown> | undefined)?.[name];
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new RpcError(RPC_ERRORS.invalidParams, `expected {${name}: {...}}`);
  }
  return v as JsonObject;
}

function topicsParam(params: unknown): Topic[] {
  const v = (params as { topics?: unknown } | undefined)?.topics;
  if (!Array.isArray(v) || !v.every((t) => (TOPICS as readonly unknown[]).includes(t))) {
    throw new RpcError(RPC_ERRORS.invalidParams, `expected {topics: [${TOPICS.join(', ')}]}`);
  }
  return v as Topic[];
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data as ArrayBuffer).toString('utf8');
}

function deny(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.end(
    `<!doctype html><meta charset="utf-8"><title>Faderlight Control Center</title>` +
      `<body style="font:15px/1.5 system-ui;background:#16181c;color:#e6e8eb;padding:48px">` +
      `<h1 style="font-size:20px">Faderlight Control Center</h1><p>${message}</p>`,
  );
}
