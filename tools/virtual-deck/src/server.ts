// The virtual deck: the deck runtime (packages/deck) on a web page instead of a Stream Deck,
// driven by the simulator (or a real TotalMix). It shows one Stream Deck XL with two profiles:
// the bundled Console (a Console Slot on every key, as in the plugin) and "My page", a page of
// specific actions as a user would build it (docs/design/03-ux.md §4a). The browser gets key
// images through server-sent events and sends key presses back.
//
//   GET  /             the page
//   GET  /events       server-sent events: `state` (everything), `image`, `profile`, `alert`, `ok`,
//                      `open` (a link to the Control Center)
//   POST /api/key      {"id": "...", "action": "down" | "up"}
//   POST /api/profile  {"profile": "console" | "own"}
//   GET  /api/state    the profile shown, its keys and their images
//   GET  /api/views    what each key shows now, as view models (for tests)
//   GET  /api/control-center?section=…  {"url": a one-time link to the Control Center}
//   GET  /pi/index.html the Property Inspector page (packages/plugin/pi), for a key's settings
//   WebSocket /        the Stream Deck app's side of the Property Inspector protocol
//
// It also runs a Control Center (packages/control-center) for its keys, as the plugin does:
// a tap on the Status key sends an `open` event with a link, and settings saved there apply to
// the keys at once (they live as long as the server). Key settings work as in the Stream Deck
// app: the page shows the plugin's Property Inspector in a frame and connects it to this
// server, which answers like the plugin; settings changed there last until the server stops.

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ControlCenterServer,
  Diagnostics,
  type ControlCenterHost,
} from '@faderlight/control-center';
import {
  blankImage,
  DeckRuntime,
  DEFAULT_SETTINGS,
  Inspectors,
  readGlobalSettings,
  SILENT,
  totalMixFolder,
  TotalMixSnapshotNames,
  type ActionKind,
  type DeckHost,
  type GlobalSettings,
  type JsonObject,
  type JsonValue,
  type Logger,
  type SnapshotNameRead,
} from '@faderlight/deck';
import { MixerStore } from '@faderlight/model';
import { renderKey, svgDataUrl, type KeyView } from '@faderlight/render';
import {
  layoutMixer,
  meterSignals,
  Simulator,
  type LayoutName,
  type MeterSetName,
} from '@faderlight/simulator';
import { connectTotalMix, systemClock, type TotalMixConnection } from '@faderlight/totalmix';
import { buildUi } from '../../../packages/control-center/scripts/build-ui.ts';
import { buildPi } from '../../../packages/plugin/scripts/build-pi.ts';
import { page } from './page.ts';

export const DEVICE = 'virtual-xl';
export const COLUMNS = 8;
export const ROWS = 4;
/** The name the runtime asks for when it opens the Console (as in the plugin manifest). */
export const CONSOLE_PROFILE = 'profiles/Console';

export type ProfileName = 'console' | 'own';

interface KeyDef {
  readonly kind: ActionKind;
  readonly settings?: JsonObject;
}

/** "My page": a few specific actions and the Console launcher, on an otherwise empty page. */
const OWN_PAGE: Readonly<Record<string, KeyDef>> = {
  '2,0': { kind: 'channel', settings: { bus: 'input', index: 8 } },
  '3,0': { kind: 'channel', settings: { bus: 'input', index: 9 } },
  '4,0': { kind: 'monitor', settings: { function: 'dim' } },
  '5,0': { kind: 'global' },
  '6,0': { kind: 'snapshot', settings: { n: 1 } },
  '7,0': { kind: 'snapshot', settings: { n: 2 } },
  '2,1': { kind: 'output' },
  '3,1': { kind: 'phones', settings: { n: 1 } },
  '4,1': { kind: 'step', settings: { output: 'main', direction: 'down' } },
  '5,1': { kind: 'step', settings: { output: 'main', direction: 'up' } },
  '6,1': { kind: 'monitor', settings: { function: 'talkback' } },
  '7,1': { kind: 'console' },
  '2,2': { kind: 'preset', settings: { output: 'main', n: 2 } },
  '0,3': { kind: 'status' },
};

/** Snapshot names for the simulator, which (like TotalMix) does not send any. */
/** The plugin's version, which the Control Center shows. */
const PLUGIN_VERSION = (
  JSON.parse(
    readFileSync(new URL('../../../packages/plugin/package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

const SIMULATOR_SNAPSHOTS = ['Tracking', 'Overdubs', 'Mixdown', 'Reference', 'Live', 'Podcast'];

function keysOf(profile: ProfileName): Map<string, KeyDef> {
  const keys = new Map<string, KeyDef>();
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const at = `${String(column)},${String(row)}`;
      const def = profile === 'console' ? { kind: 'slot' as const } : OWN_PAGE[at];
      if (def) keys.set(`${profile}:${at}`, def);
    }
  }
  return keys;
}

export interface VirtualDeckOptions {
  /** HTTP port (default 8080; 0: any free port). */
  readonly port?: number;
  /** Address to listen on (default 127.0.0.1). */
  readonly host?: string;
  /** Connect to a running TotalMix instead of starting the simulator. */
  readonly totalmix?:
    | {
        readonly host: string;
        readonly sendPort: number;
        readonly listenPort: number;
      }
    | undefined;
  /** Simulator layout and meter signals (default studio, studio). */
  readonly layout?: LayoutName;
  readonly meters?: MeterSetName | 'off';
  /** Profile shown first (default console). */
  readonly profile?: ProfileName;
  readonly log?: Logger;
}

export class VirtualDeck {
  readonly store = new MixerStore();
  readonly diagnostics = new Diagnostics();
  private readonly options: VirtualDeckOptions;
  private readonly log: Logger;
  private readonly server: Server;
  private readonly clients = new Set<ServerResponse>();
  private readonly images = new Map<string, string>();
  /** What each key shows (blank keys have none). */
  private readonly views = new Map<string, KeyView>();
  /** The view each key was last drawn from. */
  private readonly drawn = new Map<string, KeyView>();
  private readonly blank = blankImage(144);
  private sim: Simulator | undefined;
  private connection: TotalMixConnection | undefined;
  private runtime: DeckRuntime | undefined;
  private profile: ProfileName;
  private previous: ProfileName;
  private settings: GlobalSettings = DEFAULT_SETTINGS;
  private snapshotNames: { name(n: number): string | undefined; read?(): SnapshotNameRead } = {
    name: () => undefined,
  };
  private controlCenter: ControlCenterServer | undefined;
  private inspectors: Inspectors | undefined;
  /** The Property Inspector page's files. */
  private piFiles = new Map<string, string>();
  private readonly inspectorSockets = new WebSocketServer({ noServer: true });
  /** The open Property Inspector of each key. */
  private readonly piSockets = new Map<string, WebSocket>();
  /** Key settings changed in a Property Inspector, kept across profile switches. */
  private readonly keySettings = new Map<string, JsonObject>();

  constructor(options: VirtualDeckOptions = {}) {
    this.options = options;
    this.log = options.log ?? SILENT;
    this.profile = options.profile ?? 'console';
    this.previous = this.profile === 'console' ? 'own' : 'console';
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        this.log.error('request failed:', error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    this.server.on('upgrade', (req, socket, head) => {
      // Only this server's own page (its Property Inspector frame), not other web pages.
      const origin = req.headers.origin;
      if (origin !== undefined && new URL(origin).host !== req.headers.host) {
        socket.destroy();
        return;
      }
      this.inspectorSockets.handleUpgrade(req, socket, head, (ws) => {
        this.inspectorSocket(ws);
      });
    });
  }

  /** The page's address once started. */
  get url(): string {
    const a = this.server.address() as AddressInfo | null;
    return a ? `http://${a.address}:${String(a.port)}/` : '';
  }

  get shownProfile(): ProfileName {
    return this.profile;
  }

  /** A one-time link to the Control Center (after start()). */
  controlCenterLink(section?: string): string {
    if (!this.controlCenter) throw new Error('the virtual deck is not running');
    return this.controlCenter.link(section);
  }

  async start(): Promise<void> {
    const o = this.options;
    let target = o.totalmix;
    if (!target) {
      const mixer = layoutMixer(o.layout ?? 'studio');
      const meters = o.meters ?? 'studio';
      this.sim = new Simulator({
        portIn: 0,
        feedbackPort: 'sender',
        mixer,
        meters: meters === 'off' ? false : { signals: meterSignals(meters, mixer) },
      });
      await this.sim.start();
      target = { host: '127.0.0.1', sendPort: this.sim.port, listenPort: 0 };
    }
    const connection = connectTotalMix({ ...target, store: this.store });
    this.connection = connection;
    this.diagnostics.attach(connection, target);
    // The Control Center shows the connection the deck really has.
    this.settings = { ...DEFAULT_SETTINGS, connection: target };
    const host: DeckHost = {
      setImage: (id, image) => {
        this.images.set(id, image);
        const view = image === this.blank ? undefined : this.drawn.get(id);
        if (view) this.views.set(id, view);
        else this.views.delete(id);
        this.broadcast('image', { id, image });
      },
      showAlert: (id) => {
        this.broadcast('alert', { id });
      },
      showOk: (id) => {
        this.broadcast('ok', { id });
      },
      switchToProfile: (_device, profile) => {
        this.show(profile === CONSOLE_PROFILE ? 'console' : this.previous);
      },
      // Settings live as long as the server: a saved Level Preset is kept until it stops.
      saveSettings: (settings) => {
        this.settings = readGlobalSettings(settings).settings;
        this.controlCenter?.settingsChanged();
      },
      openControlCenter: (section) => {
        this.broadcast('open', { url: this.controlCenterLink(section) });
      },
    };
    // A real TotalMix on this computer has them in its state file.
    this.snapshotNames = o.totalmix
      ? new TotalMixSnapshotNames(totalMixFolder())
      : {
          name: (n) => SIMULATOR_SNAPSHOTS[n - 1],
          read: () => ({
            source: 'file',
            names: Array.from({ length: 8 }, (_, i) => SIMULATOR_SNAPSHOTS[i]),
          }),
        };
    this.runtime = new DeckRuntime({
      mixer: connection.client,
      host,
      clock: systemClock,
      settings: this.settings,
      log: this.log,
      consoleProfile: CONSOLE_PROFILE,
      snapshotNames: this.snapshotNames,
      render: (view, theme, size, id) => {
        this.drawn.set(id, view);
        return svgDataUrl(renderKey(view, theme, size));
      },
    });
    this.inspectors = new Inspectors(
      {
        view: (id) => this.runtime?.inspect(id),
        change: (id, key, value) => {
          const next = this.runtime?.changeSetting(id, key, value);
          if (next) this.keySettings.set(id, next);
          return next !== undefined;
        },
        send: (id, update) => {
          this.piSockets
            .get(id)
            ?.send(
              JSON.stringify({ event: 'sendToPropertyInspector', context: id, payload: update }),
            );
        },
        openControlCenter: (section) => {
          this.broadcast('open', { url: this.controlCenterLink(section) });
        },
      },
      systemClock,
    );
    this.piFiles = await buildPi();
    this.appearAll();
    this.controlCenter = new ControlCenterServer({
      host: this.controlCenterHost(),
      files: await buildUi(),
      log: this.log,
    });
    await this.controlCenter.start();
    await new Promise<void>((resolve) => {
      this.server.listen(o.port ?? 8080, o.host ?? '127.0.0.1', resolve);
    });
  }

  private controlCenterHost(): ControlCenterHost {
    return {
      version: `${PLUGIN_VERSION} (virtual deck)`,
      store: this.store,
      diagnostics: this.diagnostics,
      now: () => systemClock.now(),
      settings: () => this.settings,
      saveSettings: (stored) => {
        const read = readGlobalSettings(stored);
        // The keys follow at once; the deck keeps the connection it was started with.
        this.settings = read.settings;
        this.runtime?.configure(read.settings);
        return read;
      },
      resync: () => {
        this.connection?.client.resync();
      },
      snapshotNames: () =>
        this.snapshotNames.read?.() ?? { source: 'unsupported', names: Array(8).fill(undefined) },
      preview: (settings, page) => this.runtime?.preview(settings, page) ?? [],
    };
  }

  async stop(): Promise<void> {
    await this.controlCenter?.stop();
    this.inspectors?.dispose();
    for (const ws of this.inspectorSockets.clients) ws.terminate();
    this.inspectorSockets.close();
    this.diagnostics.detach();
    this.runtime?.dispose();
    for (const res of this.clients) res.end();
    this.clients.clear();
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
    await this.connection?.stop();
    await this.sim?.stop();
  }

  /** Shows a profile: its keys appear, the other profile's keys go away. */
  show(profile: ProfileName): void {
    if (profile === this.profile || !this.runtime) return;
    for (const id of keysOf(this.profile).keys()) {
      this.runtime.disappear(id);
      this.images.delete(id);
      this.views.delete(id);
      this.drawn.delete(id);
    }
    this.previous = this.profile;
    this.profile = profile;
    this.broadcast('profile', { profile });
    this.appearAll();
  }

  private appearAll(): void {
    for (const [id, def] of keysOf(this.profile)) {
      const at = id
        .slice(id.indexOf(':') + 1)
        .split(',')
        .map(Number);
      this.runtime?.appear({
        id,
        device: DEVICE,
        kind: def.kind,
        coordinates: { column: at[0] ?? 0, row: at[1] ?? 0 },
        settings: this.keySettings.get(id) ?? def.settings ?? {},
      });
    }
  }

  /** A Property Inspector page, connected the way the Stream Deck app connects it. */
  private inspectorSocket(ws: WebSocket): void {
    let key: string | undefined;
    ws.on('message', (data: Buffer) => {
      const m = JSON.parse(data.toString('utf8')) as {
        event?: unknown;
        uuid?: unknown;
        payload?: JsonValue;
      };
      if (m.event === 'registerPropertyInspector' && typeof m.uuid === 'string') {
        key = m.uuid;
        this.piSockets.set(key, ws);
        this.inspectors?.appear(key);
      } else if (m.event === 'sendToPlugin' && key !== undefined) {
        this.inspectors?.message(key, m.payload ?? null);
      }
    });
    ws.on('close', () => {
      if (key === undefined || this.piSockets.get(key) !== ws) return;
      this.piSockets.delete(key);
      this.inspectors?.disappear(key);
    });
  }

  private broadcast(event: string, data: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) res.write(message);
  }

  private state(): unknown {
    return {
      profile: this.profile,
      columns: COLUMNS,
      rows: ROWS,
      keys: [...keysOf(this.profile).keys()],
      images: Object.fromEntries(this.images),
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`event: state\ndata: ${JSON.stringify(this.state())}\n\n`);
      this.clients.add(res);
      req.on('close', () => {
        this.clients.delete(res);
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      json(res, 200, this.state());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/views') {
      json(res, 200, Object.fromEntries(this.views));
      return;
    }
    const pi = /^\/pi\/([\w.]+)$/.exec(url.pathname);
    const piFile = pi?.[1] !== undefined ? this.piFiles.get(pi[1]) : undefined;
    if (req.method === 'GET' && piFile !== undefined) {
      const type = url.pathname.endsWith('.js')
        ? 'text/javascript'
        : url.pathname.endsWith('.css')
          ? 'text/css'
          : 'text/html';
      res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
      res.end(piFile);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/control-center') {
      json(res, 200, { url: this.controlCenterLink(url.searchParams.get('section') ?? undefined) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/key') {
      const body = (await readJson(req)) as { id?: unknown; action?: unknown };
      if (typeof body.id !== 'string' || (body.action !== 'down' && body.action !== 'up')) {
        json(res, 400, { error: 'expected {"id", "action": "down" | "up"}' });
        return;
      }
      if (body.action === 'down') this.runtime?.down(body.id);
      else this.runtime?.up(body.id);
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/totalmix') {
      // A change made in TotalMix's own window, as the simulator's `set` command makes one.
      const body = (await readJson(req)) as { address?: unknown; value?: unknown };
      if (
        typeof body.address !== 'string' ||
        (typeof body.value !== 'number' && typeof body.value !== 'string')
      ) {
        json(res, 400, { error: 'expected {"address", "value": number | string}' });
        return;
      }
      if (!this.sim) {
        json(res, 409, { error: 'only the built-in simulator takes changes' });
        return;
      }
      json(res, 200, { changed: this.sim.change(body.address, body.value) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/profile') {
      const body = (await readJson(req)) as { profile?: unknown };
      if (body.profile !== 'console' && body.profile !== 'own') {
        json(res, 400, { error: 'expected {"profile": "console" | "own"}' });
        return;
      }
      this.show(body.profile);
      json(res, 200, { ok: true });
      return;
    }
    res.writeHead(404);
    res.end();
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return {};
  }
}
