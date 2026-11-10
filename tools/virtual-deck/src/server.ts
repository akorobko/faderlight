// The virtual deck: the deck runtime (packages/deck) on a web page instead of a Stream Deck,
// driven by the simulator (or a real TotalMix). It shows one Stream Deck XL with two profiles:
// the bundled Console (a Console Slot on every key, as in the plugin) and "My page", a page of
// specific actions as a user would build it (docs/design/03-ux.md §4a). The browser gets key
// images through server-sent events and sends key presses back.
//
//   GET  /             the page
//   GET  /events       server-sent events: `state` (everything), `image`, `profile`, `alert`, `ok`
//   POST /api/key      {"id": "...", "action": "down" | "up"}
//   POST /api/profile  {"profile": "console" | "own"}
//   GET  /api/state    the profile shown, its keys and their images
//   GET  /api/views    what each key shows now, as view models (for tests)

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  blankImage,
  DeckRuntime,
  DEFAULT_SETTINGS,
  SILENT,
  type ActionKind,
  type DeckHost,
  type JsonObject,
  type Logger,
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
  '0,3': { kind: 'status' },
};

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
  }

  /** The page's address once started. */
  get url(): string {
    const a = this.server.address() as AddressInfo | null;
    return a ? `http://${a.address}:${String(a.port)}/` : '';
  }

  get shownProfile(): ProfileName {
    return this.profile;
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
    };
    this.runtime = new DeckRuntime({
      mixer: connection.client,
      host,
      clock: systemClock,
      settings: DEFAULT_SETTINGS,
      log: this.log,
      consoleProfile: CONSOLE_PROFILE,
      render: (view, theme, size, id) => {
        this.drawn.set(id, view);
        return svgDataUrl(renderKey(view, theme, size));
      },
    });
    this.appearAll();
    await new Promise<void>((resolve) => {
      this.server.listen(o.port ?? 8080, o.host ?? '127.0.0.1', resolve);
    });
  }

  async stop(): Promise<void> {
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
        settings: def.settings ?? {},
      });
    }
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
