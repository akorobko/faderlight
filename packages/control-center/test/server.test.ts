import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@faderlight/deck';
import type { MixerSummary } from '../src/summary.ts';
import type { Notifications } from '../src/protocol.ts';
import { ControlCenterServer, type UiFiles } from '../src/server.ts';
import { get, login, RpcClient, TestHost } from './helpers.ts';

const FILES: UiFiles = new Map([
  ['/index.html', { type: 'text/html; charset=utf-8', body: '<!doctype html><p>page</p>' }],
  ['/app.js', { type: 'text/javascript; charset=utf-8', body: 'console.log(1)' }],
]);

let host: TestHost;
let server: ControlCenterServer;
let wall: number;
const clients: RpcClient[] = [];

beforeEach(async () => {
  host = new TestHost();
  wall = 1_000_000;
  server = new ControlCenterServer({ host, files: FILES, clock: () => wall });
  await server.start();
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server.stop();
});

async function connect(): Promise<RpcClient> {
  const cookie = await login(server.link());
  const c = await RpcClient.open(`ws://127.0.0.1:${String(server.port)}/rpc`, {
    cookie,
    origin: server.origin,
  });
  clients.push(c);
  return c;
}

describe('the Control Center server', () => {
  it('listens on 127.0.0.1 only, on a port of its own', () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.origin).toBe(`http://127.0.0.1:${String(server.port)}`);
  });

  it('refuses the page without a link', async () => {
    const reply = await get(`${server.origin}/`);
    expect(reply.status).toBe(403);
    expect(reply.body).toMatch(/Status key/);
    expect((await get(`${server.origin}/app.js`)).status).toBe(403);
  });

  it('swaps a link for a session cookie, once, and serves the page with it', async () => {
    const link = server.link('layout');
    expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?t=[\w-]{32}#layout$/);
    const first = await get(link);
    expect(first.status).toBe(303);
    expect(first.headers.location).toBe('/');
    const cookie = first.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);

    // The token is used up: without the cookie the link is refused.
    expect((await get(link)).status).toBe(403);

    const session = cookie.split(';')[0] ?? '';
    const page = await get(`${server.origin}/`, { cookie: session });
    expect(page.status).toBe(200);
    expect(page.body).toContain('page');
    expect(page.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(page.headers['cache-control']).toBe('no-store');
    expect((await get(`${server.origin}/app.js`, { cookie: session })).body).toBe('console.log(1)');
    expect((await get(`${server.origin}/missing.js`, { cookie: session })).status).toBe(404);
    // The same link opened again in that browser just shows the page.
    expect((await get(link, { cookie: session })).status).toBe(303);
  });

  it('lets a link expire after two minutes', async () => {
    const link = server.link();
    wall += 120_001;
    expect((await get(link)).status).toBe(403);
  });

  it('answers only to its own address in the Host header', async () => {
    const cookie = await login(server.link());
    const reply = await get(`${server.origin}/`, {
      cookie,
      host: `evil.example:${String(server.port)}`,
    });
    expect(reply.status).toBe(421);
    const local = await get(`${server.origin}/`, {
      cookie,
      host: `localhost:${String(server.port)}`,
    });
    expect(local.status).toBe(200);
  });

  it('opens the WebSocket only for the page itself, with a session', async () => {
    const url = `ws://127.0.0.1:${String(server.port)}/rpc`;
    const cookie = await login(server.link());
    await expect(RpcClient.open(url, { origin: server.origin })).rejects.toThrow(/403/);
    await expect(RpcClient.open(url, { cookie, origin: 'http://evil.example' })).rejects.toThrow(
      /403/,
    );
    await expect(
      RpcClient.open(`ws://127.0.0.1:${String(server.port)}/other`, {
        cookie,
        origin: server.origin,
      }),
    ).rejects.toThrow(/403/);
    const ok = await RpcClient.open(url, { cookie, origin: server.origin });
    clients.push(ok);
    const hello = await ok.call('hello');
    expect(hello.result).toEqual({
      version: '0.1.0',
      settings: DEFAULT_SETTINGS,
      defaults: DEFAULT_SETTINGS,
      palette: expect.objectContaining({
        '3': '#ff6e0a',
        '5': '#3c8cff',
        '6': '#00f027',
      }) as unknown,
    });
  });

  it('answers bad requests with JSON-RPC errors', async () => {
    const c = await connect();
    expect((await c.raw('not json')).error?.code).toBe(-32700);
    expect((await c.raw('{"jsonrpc":"2.0","method":"hello"}')).error?.code).toBe(-32600);
    expect((await c.call('nope')).error?.code).toBe(-32601);
    expect((await c.call('subscribe', { topics: ['weather'] })).error?.code).toBe(-32602);
    expect((await c.call('settings.save', {})).error?.code).toBe(-32602);
  });

  it('saves settings through the host, clamped, and tells every page', async () => {
    const a = await connect();
    const b = await connect();
    const told = b.waitFor(
      (n) =>
        n.method === 'settings' &&
        (n.params as Notifications['settings']).gestures.longPressMs === 200,
    );
    await b.call('subscribe', { topics: ['settings'] });
    const reply = await a.call('settings.save', {
      settings: { ...DEFAULT_SETTINGS, gestures: { ...DEFAULT_SETTINGS.gestures, longPressMs: 5 } },
    });
    expect(reply.result).toMatchObject({
      settings: { gestures: { longPressMs: 200 } },
      problems: ['gestures.longPressMs: 5 is below 200'],
    });
    expect(host.saved).toHaveLength(1);
    await told;
  });

  it('streams the mixer: a summary first, then changes', async () => {
    const c = await connect();
    const first = c.waitFor((n) => n.method === 'mixer');
    await c.call('subscribe', { topics: ['mixer'] });
    expect(((await first).params as MixerSummary).strips.input).toEqual([]);

    const renamed = c.waitFor(
      (n) => n.method === 'mixer' && (n.params as MixerSummary).strips.input[0]?.name === 'Vocal',
    );
    host.store.applyDevice([
      { target: { scope: 'channel', bus: 'input', index: 8, field: 'name' }, value: 'Vocal' },
    ]);
    const strip = ((await renamed).params as MixerSummary).strips.input[0];
    expect(strip).toMatchObject({ bus: 'input', index: 8, name: 'Vocal', stereo: false });
  });

  it('sends a topic it follows already again when asked, for a new listener on the page', async () => {
    host.store.applyDevice([
      { target: { scope: 'channel', bus: 'input', index: 8, field: 'name' }, value: 'Vocal' },
    ]);
    const c = await connect();
    const first = c.waitFor((n) => n.method === 'mixer');
    await c.call('subscribe', { topics: ['mixer'] });
    await first;
    // Nothing changed in the mixer, and the summary still comes again.
    const again = c.waitFor((n) => n.method === 'mixer');
    await c.call('subscribe', { topics: ['mixer'] });
    expect(((await again).params as MixerSummary).strips.input[0]).toMatchObject({ name: 'Vocal' });
  });

  it('streams the store itself: everything first, then what changed', async () => {
    const mute = { scope: 'channel', bus: 'input', index: 8, field: 'mute' } as const;
    host.store.applyDevice([{ target: mute, value: false }]);
    const c = await connect();
    const first = c.waitFor((n) => n.method === 'store');
    await c.call('subscribe', { topics: ['store'] });
    expect((await first).params).toEqual({
      reset: true,
      set: [{ key: 'channel/input/8/mute', target: mute, value: false, state: 'confirmed' }],
      removed: [],
    });

    const changed = c.waitFor((n) => n.method === 'store');
    host.store.setPending(mute, true);
    expect((await changed).params).toMatchObject({
      reset: false,
      set: [{ key: 'channel/input/8/mute', value: true, state: 'pending' }],
    });

    const removed = c.waitFor((n) => n.method === 'store');
    host.store.clear();
    expect((await removed).params).toMatchObject({ removed: ['channel/input/8/mute'] });
  });

  it('sends an output that is off as "-Infinity", since JSON has no -Infinity', async () => {
    const c = await connect();
    const first = c.waitFor((n) => n.method === 'store');
    host.store.applyDevice([
      { target: { scope: 'channel', bus: 'output', index: 2, field: 'volume' }, value: -Infinity },
    ]);
    await c.call('subscribe', { topics: ['store'] });
    expect(JSON.stringify((await first).params)).toContain('"value":"-Infinity"');
  });

  it('streams the packet log, and clears it', async () => {
    host.diagnostics.log.add({
      at: 1,
      dir: 'in',
      address: '/input/8/mute',
      args: 'f:1',
      meter: false,
    });
    const c = await connect();
    const first = c.waitFor((n) => n.method === 'packets');
    await c.call('subscribe', { topics: ['packets'] });
    expect((await first).params).toMatchObject({
      reset: true,
      entries: [{ n: 1, address: '/input/8/mute' }],
    });

    const more = c.waitFor((n) => n.method === 'packets');
    host.diagnostics.log.add({
      at: 2,
      dir: 'out',
      address: '/sendstate',
      args: 'f:1',
      meter: false,
    });
    expect((await more).params).toMatchObject({ reset: false, entries: [{ n: 2, dir: 'out' }] });

    const cleared = c.waitFor((n) => n.method === 'packets');
    await c.call('packets.clear');
    expect((await cleared).params).toMatchObject({ reset: true, entries: [] });

    await c.call('packets.meters', { on: true });
    expect(host.diagnostics.log.meters).toBe(true);
  });

  it('streams the connection report with the Setup Assistant checks', async () => {
    const c = await connect();
    const first = c.waitFor((n) => n.method === 'connection');
    await c.call('subscribe', { topics: ['connection'] });
    const params = (await first).params as Notifications['connection'];
    expect(params.report.link).toBe('idle');
    expect(params.checks.map((k) => k.id)).toEqual([
      'port',
      'reply',
      'sync',
      'levels',
      'changes',
      'names',
    ]);
  });

  it('reads the mixer again when asked', async () => {
    const c = await connect();
    await c.call('mixer.resync');
    expect(host.resyncs).toBe(1);
  });
});
