import {
  activeSnapshot,
  channel,
  controlRoom,
  mainOutput,
  MixerStore,
  phonesOutput,
  route,
  routeLevel,
  snapshot,
  strips,
  type ConnectionState,
  type Target,
  type Value,
} from '@faderlight/model';
import { float, message, str } from '@faderlight/osc';
import { describe, expect, it } from 'vitest';
import { TotalMixClient, type ClientOptions } from '../src/index.ts';
import { BASELINE, readCapture, step } from './capture.ts';
import { FakeClock, FakeLink, statusReply } from './fakes.ts';

const capture = readCapture(BASELINE);
/** The state datagrams TotalMix sent in reply to /sendall 2 in the baseline capture. */
const sendall2 = step(capture, 'sendall-2').received.filter((d) => !d.meter);

function setup(options: Partial<ClientOptions> = {}) {
  const clock = new FakeClock();
  const link = new FakeLink(clock);
  const store = new MixerStore();
  const client = new TotalMixClient(link, store, { clock, ...options });
  const states: ConnectionState[] = [];
  client.on('state', (s) => states.push(s));
  const failed: [Target, Value, string][] = [];
  client.on('commandFailed', (t, v, reason) => failed.push([t, v, reason]));
  return { clock, link, store, client, states, failed };
}

type Setup = ReturnType<typeof setup>;

/** Feeds the recorded /sendall 2 reply. */
function dump({ client }: Setup): void {
  for (const d of sendall2) client.receive(d.messages);
}

/** Drives the client from idle to live with the recorded dump. */
function goLive(s: Setup): void {
  s.client.start();
  s.client.receive(statusReply);
  s.clock.advance(10); // request spacing after the probe
  dump(s);
  s.clock.advance(150); // quiet: the fence /sendstate goes out
  s.client.receive(statusReply);
  expect(s.client.state).toBe('live');
  s.link.clear();
}

describe('connection state machine', () => {
  it('probes with /sendstate once a second until TotalMix answers', () => {
    const s = setup();
    expect(s.client.state).toBe('idle');
    s.client.start();
    expect(s.client.state).toBe('probing');
    expect(s.store.connection).toBe('probing');
    expect(s.link.texts()).toEqual(['/sendstate f:1']);
    s.clock.advance(1000);
    s.clock.advance(1000);
    expect(s.link.count('/sendstate f:1')).toBe(3);
    expect(s.client.state).toBe('probing');
  });

  it('ignores meters while probing: only a /sendstate reply proves the slot works both ways', () => {
    const s = setup();
    s.client.start();
    s.client.receive([message('/level/in/8', float(-40))]);
    expect(s.client.state).toBe('probing');
  });

  it('syncs with /sendall 2 after the first reply and goes live once the dump is complete', () => {
    const s = setup();
    s.client.start();
    s.client.receive(statusReply);
    expect(s.client.state).toBe('syncing');
    s.clock.advance(10);
    expect(s.link.texts()).toEqual(['/sendstate f:1', '/sendall f:2']);

    dump(s);
    s.clock.advance(149);
    expect(s.link.count('/sendstate f:1')).toBe(1);
    s.clock.advance(1);
    // The dump went quiet: a /sendstate behind it checks TotalMix is still answering.
    expect(s.link.count('/sendstate f:1')).toBe(2);
    expect(s.client.state).toBe('syncing');
    s.client.receive(statusReply);
    expect(s.client.state).toBe('live');
    expect(s.states).toEqual(['probing', 'syncing', 'live']);
    expect(s.store.synced).toBe(true);
  });

  it('builds the channel list, Main and phones from what TotalMix reported', () => {
    const s = setup();
    goLive(s);
    const { store } = s;
    expect(strips(store, 'input').map((x) => [x.index, x.name, x.label])).toEqual([
      [2, 'AXE FX', 'AN 3/4'],
      [4, 'RD 2000', 'AN 5'],
      [5, 'AN 6', 'AN 6'],
      [8, 'OC 818', 'Mic 9/10'],
      [10, 'Guitar', 'Mic 11'],
      [11, 'RE 20', 'Mic 12'],
      [14, 'PC', 'ADAT 1/2'],
    ]);
    expect(strips(store, 'playback').map((x) => x.name)).toEqual([
      'FROM ZOOM',
      'MAC OUT',
      'FROM DAW',
    ]);
    expect(strips(store, 'output').map((x) => x.index)).toEqual([0, 2, 8, 14, 16, 30]);
    expect(mainOutput(store)).toMatchObject({ index: 2, name: 'Main', label: 'AN 3/4' });
    expect(phonesOutput(store, 1)).toMatchObject({ index: 8, name: 'Phones 1', label: 'PH 9/10' });
    // Phones 2 is assigned to output 10, which is hidden in TotalMix, so it is not on the wire.
    expect(store.value(controlRoom('phones2'))).toBe(10);
    expect(phonesOutput(store, 2)).toBeUndefined();
    expect(activeSnapshot(store)).toEqual({ n: 1, modified: false });
    expect(store.value({ scope: 'status', field: 'device' })).toBe('Fireface UFX III');
    expect(store.value(channel('output', 2, 'volume'))).toBe(-20);
    expect(routeLevel(store, 'playback', 4, 0)).toBe(-16.23);
    expect(routeLevel(store, 'input', 8, 2)).toBe(-Infinity); // off: not in /sendall 2
  });

  it('removes channels the dump did not report (hidden since the last sync)', () => {
    const s = setup();
    s.store.applyDevice([{ target: channel('input', 0, 'name'), value: 'AN 1' }]);
    goLive(s);
    expect(s.store.get(channel('input', 0, 'name'))).toBeUndefined();
  });

  it('does not trust a dump when the fence /sendstate gets no reply', () => {
    const s = setup();
    s.store.applyDevice([{ target: channel('input', 0, 'name'), value: 'AN 1' }]);
    s.client.start();
    s.client.receive(statusReply);
    s.clock.advance(10);
    dump(s);
    s.clock.advance(150 + 3000);
    expect(s.client.state).toBe('probing');
    expect(s.store.value(channel('input', 0, 'name'))).toBe('AN 1'); // nothing removed
  });

  it('gives up a sync that gets no reply and probes again', () => {
    const s = setup();
    s.client.start();
    s.client.receive(statusReply);
    s.clock.advance(10 + 2999);
    expect(s.client.state).toBe('syncing');
    s.clock.advance(1);
    expect(s.client.state).toBe('probing');
    expect(s.store.synced).toBe(false);
  });

  it('polls once a second while live and stays live while TotalMix answers', () => {
    const s = setup();
    goLive(s);
    for (let i = 0; i < 5; i++) {
      s.clock.advance(1000);
      s.client.receive(statusReply);
    }
    expect(s.link.count('/sendstate f:1')).toBe(5);
    expect(s.client.state).toBe('live');
  });

  it('turns stale after 3 unanswered polls, keeps the values and clears the meters', () => {
    const s = setup();
    goLive(s);
    s.client.receive([message('/level/in/8', float(-12))]);
    expect(s.store.meters.has('input', 8)).toBe(true);
    s.clock.advance(3000);
    expect(s.link.count('/sendstate f:1')).toBe(3);
    expect(s.client.state).toBe('live');
    s.clock.advance(1000);
    expect(s.client.state).toBe('stale');
    expect(s.store.connection).toBe('stale');
    expect(s.store.value(channel('input', 8, 'name'))).toBe('OC 818');
    expect(s.store.meters.has('input', 8)).toBe(false);
  });

  it('keeps probing while stale and syncs again on the next reply', () => {
    const s = setup();
    goLive(s);
    s.clock.advance(4000);
    expect(s.client.state).toBe('stale');
    s.link.clear();
    s.clock.advance(2000);
    expect(s.link.count('/sendstate f:1')).toBeGreaterThanOrEqual(2);
    s.client.receive(statusReply);
    expect(s.client.state).toBe('syncing');
    s.clock.advance(10);
    expect(s.link.texts()).toContain('/sendall f:2');
  });

  it('syncs again when TotalMix restarts (feedback from a new source port)', () => {
    const s = setup();
    goLive(s);
    s.client.sourceChanged(undefined); // the first datagram ever: nothing to do
    expect(s.client.state).toBe('live');
    s.client.sourceChanged({ address: '127.0.0.1', port: 52391 });
    expect(s.client.state).toBe('syncing');
    s.clock.advance(10);
    expect(s.link.texts()).toContain('/sendall f:2');
  });

  it('goes idle on stop() and sends nothing more', () => {
    const s = setup();
    goLive(s);
    s.client.stop();
    expect(s.client.state).toBe('idle');
    s.clock.advance(10_000);
    expect(s.link.sent).toEqual([]);
    s.client.receive(statusReply);
    expect(s.client.state).toBe('idle');
  });

  it('reports messages it does not know', () => {
    const s = setup();
    const unknown: string[] = [];
    s.client.on('unknownMessage', (m, reason) => unknown.push(`${m.address}: ${reason}`));
    s.client.start();
    s.client.receive([message('/faderlight/probe', float(1))]);
    expect(unknown).toEqual(['/faderlight/probe: unknown address']);
  });

  it('records meter levels with the time they arrived', () => {
    const s = setup();
    goLive(s);
    s.clock.advance(500);
    s.client.receive([message('/level/in/8', float(6)), message('/level/out/2', float(-30))]);
    expect(s.store.meters.read('input', 8, s.clock.now())).toEqual({
      level: 6,
      peak: 6,
      clip: true,
    });
    expect(s.store.meters.read('output', 2, s.clock.now()).level).toBe(-30);
  });
});

describe('optimistic writes', () => {
  const mute = channel('input', 8, 'mute');
  const muteReply = (on: boolean) => [message('/input/8/mute', float(on ? 1 : 0))];

  it('sends the write at once, shows it as pending, and asks for the channel 75 ms later', () => {
    const s = setup();
    goLive(s);
    expect(s.client.set(mute, true)).toBe(true);
    expect(s.link.texts()).toEqual(['/input/8/mute f:1']);
    expect(s.store.get(mute)).toMatchObject({ value: true, state: 'pending' });
    s.clock.advance(74);
    expect(s.link.texts()).toEqual(['/input/8/mute f:1']);
    s.clock.advance(1);
    expect(s.link.texts()).toEqual(['/input/8/mute f:1', '/sendchan/input/8 f:1']);
    s.client.receive(muteReply(true));
    expect(s.store.get(mute)).toMatchObject({ value: true, state: 'confirmed' });
    s.clock.advance(5000);
    expect(s.failed).toEqual([]);
  });

  it('takes the reply as a correction when TotalMix reports something else', () => {
    const s = setup();
    goLive(s);
    s.client.set(channel('output', 2, 'volume'), 12);
    s.clock.advance(75);
    s.client.receive([message('/output/2/volume', float(6))]);
    expect(s.store.get(channel('output', 2, 'volume'))).toMatchObject({
      value: 6,
      state: 'confirmed',
    });
    expect(s.failed).toEqual([]);
  });

  it('ignores a different value that arrives before the confirming request', () => {
    const s = setup();
    goLive(s);
    s.client.set(mute, true);
    s.client.receive(muteReply(false)); // an older reply crossing the write
    expect(s.store.get(mute)).toMatchObject({ value: true, state: 'pending' });
    s.clock.advance(75);
    s.client.receive(muteReply(true));
    expect(s.store.get(mute)?.state).toBe('confirmed');
  });

  it('rolls back when the confirming request gets no answer', () => {
    const s = setup();
    goLive(s);
    const hidden = channel('input', 0, 'mute'); // hidden channels get no /sendchan reply
    s.client.set(hidden, true);
    s.clock.advance(75 + 999);
    expect(s.store.isPending(hidden)).toBe(true);
    s.clock.advance(1);
    expect(s.store.get(hidden)).toBeUndefined();
    expect(s.failed).toEqual([[hidden, true, 'no confirmation']]);
  });

  it('rolls back to the previous value, not to unknown, when the channel was known', () => {
    const s = setup();
    goLive(s);
    s.client.set(mute, true);
    s.clock.advance(75 + 1000);
    expect(s.store.get(mute)).toMatchObject({ value: false, state: 'confirmed' });
  });

  it('confirms several writes on one channel with one request', () => {
    const s = setup();
    goLive(s);
    s.client.set(mute, true);
    s.client.set(channel('input', 8, 'phantom'), true);
    s.clock.advance(75);
    expect(s.link.count('/sendchan/input/8 f:1')).toBe(1);
    s.client.receive([...muteReply(true), message('/input/8/48v', float(1))]);
    expect(s.store.isPending(mute)).toBe(false);
    expect(s.store.isPending(channel('input', 8, 'phantom'))).toBe(false);
  });

  it('waits for the last of quick repeated writes before confirming', () => {
    const s = setup();
    goLive(s);
    const vol = channel('output', 2, 'volume');
    for (let i = 0; i < 5; i++) {
      s.client.set(vol, -20 + i);
      s.clock.advance(50);
    }
    expect(s.link.count('/sendchan/output/2 f:1')).toBe(0);
    s.clock.advance(25);
    expect(s.link.count('/sendchan/output/2 f:1')).toBe(1);
    expect(s.store.value(vol)).toBe(-16);
  });

  it('confirms names by their echo (TotalMix echoes names)', () => {
    const s = setup();
    goLive(s);
    const name = channel('input', 8, 'name');
    s.client.set(name, 'FL test');
    s.clock.advance(18);
    s.client.receive([message('/input/8/name', str('FL test'))]);
    expect(s.store.get(name)).toMatchObject({ value: 'FL test', state: 'confirmed' });
  });

  it('confirms control room, group and route writes with /sendsettings and /sendsubmix', () => {
    const s = setup();
    goLive(s);
    s.client.set(controlRoom('dim'), true);
    s.client.set({ scope: 'group', group: 'mute', n: 1 }, true);
    s.client.set(route('input', 2, 0, 'fader'), -6);
    s.clock.advance(75 + 10 + 10);
    expect(s.link.texts().slice(3)).toEqual(['/sendsettings f:1', '/sendsubmix/0 f:1']);
  });

  it('loads a snapshot, shows it as active and confirms with /sendsettings', () => {
    const s = setup();
    goLive(s);
    expect(s.client.loadSnapshot(3)).toBe(true);
    expect(s.link.texts()).toEqual(['/snapshot/load/3 f:1']);
    expect(s.store.get(snapshot(3))).toMatchObject({ value: 'active', state: 'pending' });
    s.clock.advance(75);
    expect(s.link.texts()).toContain('/sendsettings f:1');
    s.client.receive([
      message('/snapshot/load/1', float(0)),
      message('/snapshot/load/3', float(2)),
    ]);
    expect(activeSnapshot(s.store)).toEqual({ n: 3, modified: false });
  });

  it('refuses writes unless live or syncing', () => {
    const s = setup();
    expect(s.client.set(mute, true)).toBe(false);
    s.client.start();
    expect(s.client.set(mute, true)).toBe(false);
    expect(s.link.texts()).toEqual(['/sendstate f:1']);
    expect(s.store.get(mute)).toBeUndefined();
  });

  it('refuses a write the link cannot send', () => {
    const s = setup();
    goLive(s);
    s.link.up = false;
    expect(s.client.set(mute, true)).toBe(false);
    expect(s.store.isPending(mute)).toBe(false);
  });

  it('throws for invalid writes', () => {
    const s = setup();
    goLive(s);
    expect(() => s.client.set(mute, 1)).toThrow(/not a valid switch/);
    expect(() => s.client.set({ scope: 'status', field: 'dsp' }, 1)).toThrow(/read-only/);
  });

  it('rolls back writes in flight when the connection is lost', () => {
    const s = setup();
    goLive(s);
    s.client.set(mute, true);
    s.clock.advance(75); // confirming request sent, never answered...
    s.link.up = false; // ...and TotalMix is gone
    s.clock.advance(4000);
    expect(s.store.get(mute)).toMatchObject({ value: false, state: 'confirmed' });
    expect(s.failed.map((f) => f[2])).toEqual(['no confirmation']);
  });

  it('rolls back with "stopped" when the client stops', () => {
    const s = setup();
    goLive(s);
    s.client.set(mute, true);
    s.client.stop();
    expect(s.failed).toEqual([[mute, true, 'stopped']]);
    expect(s.store.value(mute)).toBe(false);
  });
});

describe('request pacing', () => {
  it('spaces requests 10 ms apart, and 100 ms after a full dump request', () => {
    const s = setup();
    goLive(s);
    for (const index of [2, 4, 5]) s.client.refresh({ type: 'channel', bus: 'input', index });
    s.client.refresh({ type: 'all', routes: 'all' });
    s.client.refresh({ type: 'settings' });
    s.clock.advance(1000);
    const at = s.link.sent.map((x) => x.at);
    expect(s.link.texts().slice(0, 5)).toEqual([
      '/sendchan/input/2 f:1',
      '/sendchan/input/4 f:1',
      '/sendchan/input/5 f:1',
      '/sendall f:1',
      '/sendsettings f:1',
    ]);
    expect(at.slice(0, 5).map((t) => t - (at[0] ?? 0))).toEqual([0, 10, 20, 30, 130]);
  });

  it('does not queue a request twice', () => {
    const s = setup();
    goLive(s);
    s.client.refresh({ type: 'settings' }); // sent at once
    s.client.refresh({ type: 'channel', bus: 'input', index: 8 });
    s.client.refresh({ type: 'channel', bus: 'input', index: 8 });
    s.clock.advance(100);
    expect(s.link.count('/sendchan/input/8 f:1')).toBe(1);
  });

  it('sends polls and confirmations before plain refreshes', () => {
    const s = setup();
    goLive(s);
    s.clock.advance(20);
    s.client.refresh({ type: 'all', routes: 'all' }); // sent at once; the next request waits 100 ms
    s.client.refresh({ type: 'channel', bus: 'input', index: 2 });
    s.client.refresh({ type: 'channel', bus: 'input', index: 4 });
    s.client.set(channel('input', 8, 'mute'), true);
    s.clock.advance(150);
    // The confirmation was queued at 75 ms, behind the refreshes, but goes out first.
    expect(s.link.texts()).toEqual([
      '/sendall f:1',
      '/input/8/mute f:1',
      '/sendchan/input/8 f:1',
      '/sendchan/input/2 f:1',
      '/sendchan/input/4 f:1',
    ]);
  });
});
