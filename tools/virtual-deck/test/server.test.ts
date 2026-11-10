// The virtual deck's HTTP API against its own simulator, without a browser (the browser tests
// are in e2e/ and run with npm run e2e).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  it('refuses requests it does not understand', async () => {
    expect((await post('/api/key', { id: 'x', action: 'hold' })).status).toBe(400);
    expect((await post('/api/profile', { profile: 'other' })).status).toBe(400);
    expect((await fetch(new URL('/nothing', deck.url))).status).toBe(404);
  });
});
