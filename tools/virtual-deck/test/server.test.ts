// The virtual deck's HTTP API against its own simulator, without a browser (the browser tests
// are in e2e/ and run with npm run e2e).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { InspectorView } from '@faderlight/deck';
import { VirtualDeck } from '../src/server.ts';

let deck: VirtualDeck;

beforeAll(async () => {
  deck = new VirtualDeck({ port: 0, meters: 'off' });
  await deck.start();
});

afterAll(async () => {
  await deck.stop();
});

const get = async (path: string): Promise<unknown> => (await fetch(new URL(path, deck.url))).json();

const post = (path: string, body: unknown) =>
  fetch(new URL(path, deck.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

type Views = Record<string, Record<string, unknown> | undefined>;

async function until(test: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await test())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const view = async (id: string) => ((await get('/api/views')) as Views)[id];

describe('the virtual deck server', () => {
  it('serves the page and the Console profile', async () => {
    const html = await (await fetch(deck.url)).text();
    expect(html).toContain('<div id="deck"');
    const state = (await get('/api/state')) as { profile: string; keys: string[] };
    expect(state.profile).toBe('console');
    expect(state.keys).toHaveLength(32);
  });

  it('passes key presses to the deck runtime', async () => {
    await until(async () => (await view('console:6,0'))?.link === 'live');
    await post('/api/key', { id: 'console:1,1', action: 'down' });
    await post('/api/key', { id: 'console:1,1', action: 'up' });
    await until(async () => (await view('console:1,1'))?.muted === true);
  });

  it('switches profiles', async () => {
    await post('/api/profile', { profile: 'own' });
    expect(deck.shownProfile).toBe('own');
    const state = (await get('/api/state')) as { keys: string[] };
    expect(state.keys).toContain('own:7,1');
    await post('/api/profile', { profile: 'console' });
  });

  it('hands out Control Center links, and sends one when the Status key is tapped', async () => {
    const { url } = (await get('/api/control-center?section=connection')) as { url: string };
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?t=[\w-]+#connection$/);
    const opened = await fetch(url, { redirect: 'manual' });
    expect(opened.status).toBe(303);
    expect(opened.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict/);

    const events = new AbortController();
    const stream = await fetch(new URL('/events', deck.url), { signal: events.signal });
    const reader = stream.body?.pipeThrough(new TextDecoderStream()).getReader();
    if (!reader) throw new Error('no event stream');
    await post('/api/key', { id: 'console:6,0', action: 'down' });
    await post('/api/key', { id: 'console:6,0', action: 'up' });
    let text = '';
    let open: RegExpExecArray | null = null;
    while (!open) {
      const { done, value } = await reader.read();
      if (done) throw new Error('the event stream ended');
      text += value;
      open = /event: open\ndata: (.*)\n\n/.exec(text);
    }
    events.abort();
    expect(JSON.parse(open[1] ?? '')).toEqual({
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/\?t=[\w-]+#connection$/) as string,
    });
  });

  it('answers a Property Inspector like the plugin, and the key follows its changes', async () => {
    const page = await fetch(new URL('/pi/index.html', deck.url));
    expect(await page.text()).toContain('<script src="pi.js"></script>');
    await post('/api/profile', { profile: 'own' });
    const ws = new WebSocket(deck.url.replace('http', 'ws'));
    const views: InspectorView[] = [];
    ws.on('message', (data: Buffer) => {
      const m = JSON.parse(data.toString('utf8')) as { payload: { view: InspectorView } };
      views.push(m.payload.view);
    });
    await new Promise((resolve) => {
      ws.once('open', resolve);
    });
    ws.send(JSON.stringify({ event: 'registerPropertyInspector', uuid: 'own:6,0' }));
    await until(async () => Promise.resolve(views.length > 0));
    expect(views[0]?.summary).toBe('Loads snapshot 1 (Tracking).');
    ws.send(
      JSON.stringify({
        event: 'sendToPlugin',
        context: 'own:6,0',
        payload: { event: 'set', key: 'n', value: 3 },
      }),
    );
    await until(async () =>
      Promise.resolve(views.at(-1)?.summary === 'Loads snapshot 3 (Mixdown).'),
    );
    ws.close();
    // Kept across a profile switch, as the app keeps an action's settings.
    await post('/api/profile', { profile: 'console' });
    await post('/api/profile', { profile: 'own' });
    await until(async () => (await view('own:6,0'))?.n === 3);
    await post('/api/profile', { profile: 'console' });
  });

  it('refuses a Property Inspector socket from another web page', async () => {
    const ws = new WebSocket(deck.url.replace('http', 'ws'), { origin: 'http://example.com' });
    await expect(
      new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      }),
    ).rejects.toThrow();
  });

  it('refuses requests it does not understand', async () => {
    expect((await post('/api/key', { id: 'x', action: 'hold' })).status).toBe(400);
    expect((await post('/api/profile', { profile: 'other' })).status).toBe(400);
    expect((await fetch(new URL('/nothing', deck.url))).status).toBe(404);
  });
});
