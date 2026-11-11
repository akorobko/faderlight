import { channel, controlRoom, type Target } from '@faderlight/model';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DeckRuntime,
  type ActionKind,
  type GlobalSettings,
  type JsonObject,
  type Logger,
} from '../src/index.ts';
import { renderJson, TestHost } from './host.ts';
import { Loopback } from './loopback.ts';

let mixer: Loopback;
let host: TestHost;
let deck: DeckRuntime;
let errors: unknown[][];

function start(settings: GlobalSettings = DEFAULT_SETTINGS): void {
  mixer = new Loopback().connect();
  host = new TestHost();
  errors = [];
  const log: Logger = {
    error: (...args: unknown[]) => errors.push(args),
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
  };
  deck = new DeckRuntime({
    mixer,
    host,
    clock: mixer.clock,
    settings,
    log,
    render: renderJson,
  });
}

const advance = (ms: number) => {
  mixer.clock.advance(ms);
};

function place(id: string, kind: ActionKind, settings: JsonObject = {}): void {
  deck.appear({ id, device: 'XL', kind, coordinates: { column: 0, row: 0 }, settings });
  advance(20);
}

function press(id: string, holdMs = 30): void {
  deck.down(id);
  advance(holdMs);
  deck.up(id);
}

/** A tap, then time for the write to be confirmed and the key drawn again. */
function tap(id: string): void {
  press(id);
  advance(400);
}

const value = (t: Target) => mixer.store.value(t);

beforeEach(() => {
  start();
});

describe('DeckRuntime: specific actions', () => {
  it('a Channel key shows its strip and mutes it with a tap', () => {
    place('vocal', 'channel', { bus: 'input', index: 8 });
    expect(host.view('vocal')).toMatchObject({
      kind: 'channel',
      label: 'MIC 9',
      name: 'Vocal',
      value: { kind: 'gain', db: 42 },
      muted: false,
      badges: { phantom: true },
      offline: false,
    });
    tap('vocal');
    expect(mixer.writes).toEqual([[channel('input', 8, 'mute'), true]]);
    expect(mixer.sim.channelValue('input', 8, 'mute')).toBe(1);
    expect(host.view('vocal')).toMatchObject({ muted: true, pending: false });
  });

  it('a long press on a Channel key is not a tap, and the tap waits for key up', () => {
    place('vocal', 'channel', { bus: 'input', index: 8, hold: 'phantom' });
    deck.down('vocal');
    advance(100);
    expect(mixer.writes).toEqual([]);
    advance(DEFAULT_SETTINGS.gestures.longPressMs);
    expect(mixer.writes).toEqual([[channel('input', 8, 'phantom'), false]]);
    deck.up('vocal');
    advance(400);
    expect(mixer.writes).toHaveLength(1);
    expect(host.view('vocal')).toMatchObject({ badges: { phantom: false } });
  });

  it('with no long press, a Channel key acts on key down', () => {
    place('vocal', 'channel', { bus: 'input', index: 8, tap: 'solo', hold: 'none' });
    deck.down('vocal');
    const solo: Target = { scope: 'route', source: 'input', index: 8, output: 0, field: 'solo' };
    expect(mixer.writes).toEqual([[solo, true]]);
    deck.up('vocal');
  });

  it('a playback channel shows its level into Main', () => {
    place('browser', 'channel', { bus: 'playback', index: 2 });
    expect(host.view('browser')).toMatchObject({
      label: 'AN 3/4',
      name: 'Browser',
      value: { kind: 'level', db: -6, caption: 'Fader' },
    });
  });

  it('a channel that is not shown in TotalMix is drawn offline with its label', () => {
    place('hidden', 'channel', { bus: 'input', index: 4 });
    expect(host.view('hidden')).toMatchObject({ kind: 'channel', label: 'AN 5', offline: true });
    press('hidden');
    advance(400);
    expect(host.alerts).toEqual(['hidden']);
    expect(mixer.writes).toEqual([]);
  });

  it('Main follows the output TotalMix uses as Main, and a tap mutes it', () => {
    place('main', 'output');
    expect(host.view('main')).toMatchObject({
      kind: 'output',
      role: 'main',
      title: 'MAIN',
      name: 'Main',
      volume: -20,
      monitor: { dim: false },
    });
    tap('main');
    expect(value(channel('output', 0, 'mute'))).toBe(true);
    mixer.sim.setValue('/controlroom/mainout', 8);
    mixer.resync();
    advance(1000);
    expect(host.view('main')).toMatchObject({ name: 'Phones 1', volume: -12 });
  });

  it('a Phones key shows the output assigned to it, or nothing when TotalMix shows none', () => {
    place('ph1', 'phones', { n: 1 });
    place('ph2', 'phones', { n: 2 });
    place('ph3', 'phones', { n: 3 });
    expect(host.view('ph1')).toMatchObject({ role: 'phones', title: 'PHONES 1', name: 'Phones 1' });
    expect(host.view('ph2')).toMatchObject({ name: 'Phones 2' });
    // Phones 3 is not set up: a blank key, and a tap does nothing.
    expect(host.view('ph3')).toBeUndefined();
    tap('ph3');
    expect(host.alerts).toEqual([]);
    // Phones 2's output hidden in TotalMix: it is not on the wire any more, so blank too.
    mixer.sim.setVisible('output', 10, false);
    mixer.resync();
    advance(1000);
    expect(host.view('ph2')).toBeUndefined();
  });

  it('a Main key says "Not assigned" when TotalMix shows no Main output', () => {
    place('main', 'output');
    mixer.sim.setVisible('output', 0, false);
    mixer.resync();
    advance(1000);
    expect(host.view('main')).toMatchObject({ name: 'Not assigned', unassigned: true });
    expect(host.view('main')).not.toHaveProperty('offline', true);
  });

  it('a Volume Step key repeats while held and speeds up after 1.5 s', () => {
    place('up', 'step', { output: 'main', direction: 'up' });
    deck.down('up');
    advance(100);
    expect(host.view('up')).toMatchObject({ kind: 'step', held: true, target: 'MAIN' });
    // Ticks at 0, 400, 500, ... 1900 ms: twelve of 0.5 dB, then five of 1 dB.
    advance(1840);
    deck.up('up');
    advance(400);
    expect(mixer.writes).toHaveLength(17);
    expect(value(channel('output', 0, 'volume'))).toBe(-9);
    expect(mixer.sim.channelValue('output', 0, 'volume')).toBe(-9);
    expect(host.view('up')).toMatchObject({ held: false, db: -9 });
  });

  it('a Snapshot key loads its snapshot', () => {
    place('snap2', 'snapshot', { n: 2 });
    expect(host.view('snap2')).toMatchObject({ kind: 'snapshot', n: 2, state: 'inactive' });
    tap('snap2');
    advance(1000);
    expect(value(channel('input', 0, 'mute'))).toBe(true);
    expect(host.view('snap2')).toMatchObject({ state: 'active' });
  });

  it('Monitor and Global keys flip their switch', () => {
    place('dim', 'monitor', { function: 'dim' });
    place('mono', 'monitor', { function: 'mono' });
    place('gm', 'global');
    tap('dim');
    tap('mono');
    tap('gm');
    expect(value(controlRoom('dim'))).toBe(true);
    expect(value(controlRoom('mainMono'))).toBe(true);
    expect(value({ scope: 'global', field: 'mute' })).toBe(true);
    expect(host.view('dim')).toMatchObject({ kind: 'toggle', function: 'dim', on: true });
    expect(host.view('gm')).toMatchObject({ function: 'globalMute', on: true });
  });

  it('Talkback is on while held, and a double tap latches it until the next press', () => {
    place('tb', 'monitor', { function: 'talkback' });
    const tb = controlRoom('talkback');
    deck.down('tb');
    advance(150); // past the key's 100 ms image gap, well short of a long press
    expect(value(tb)).toBe(true);
    expect(host.view('tb')).toMatchObject({ on: true, caption: 'talking' });
    deck.up('tb');
    advance(500);
    expect(value(tb)).toBe(false);

    press('tb', 40);
    advance(100);
    press('tb', 40);
    advance(600);
    expect(value(tb)).toBe(true);
    // The next press switches it off, and its release does nothing more.
    press('tb', 40);
    advance(600);
    expect(value(tb)).toBe(false);
    expect(mixer.writes.filter(([t]) => t === tb || t.scope === 'controlRoom').at(-1)).toEqual([
      tb,
      false,
    ]);
  });

  it('a Status key shows the link and reads the mixer again on a long press', () => {
    place('status', 'status');
    expect(host.view('status')).toMatchObject({
      kind: 'status',
      link: 'live',
      device: 'Fireface UFX III',
    });
    press('status', DEFAULT_SETTINGS.gestures.longPressMs + 50);
    expect(host.oks).toEqual(['status']);
    advance(1000);
    expect(mixer.client.state).toBe('live');
    mixer.answering = false;
    advance(5000);
    expect(host.view('status')).toMatchObject({
      link: 'stale',
      message: 'TotalMix stopped answering',
    });
    press('status', DEFAULT_SETTINGS.gestures.longPressMs + 50);
    expect(host.alerts).toEqual(['status']);
  });

  it('a tap on the Status key opens the Control Center on its Connection page', () => {
    place('status', 'status');
    press('status', 40);
    advance(DEFAULT_SETTINGS.gestures.doubleTapMs + 10);
    expect(host.opened).toEqual(['connection']);
    expect(host.alerts).toEqual([]);
  });

  it('keys still show their last values, greyed, when TotalMix stops answering', () => {
    place('vocal', 'channel', { bus: 'input', index: 8 });
    mixer.answering = false;
    advance(5000);
    expect(host.view('vocal')).toMatchObject({ name: 'Vocal', offline: true });
    tap('vocal');
    expect(host.alerts).toEqual(['vocal']);
  });
});

describe('DeckRuntime: keys and frames', () => {
  it('sends a key again only when its image changes', () => {
    place('dim', 'monitor', { function: 'dim' });
    place('gm', 'global');
    const before = host.count('gm');
    tap('dim');
    expect(host.count('dim')).toBeGreaterThan(1);
    expect(host.count('gm')).toBe(before);
  });

  it('meter keys animate at the meter rate, other keys only when something changes', () => {
    place('vocal', 'channel', { bus: 'input', index: 8 });
    place('dim', 'monitor', { function: 'dim' });
    const dimBefore = host.count('dim');
    for (let t = 0; t < 1000; t += 10) {
      mixer.store.meters.push('input', 8, -40 + (t % 200) / 10, mixer.clock.now());
      advance(10);
    }
    const frames = host.count('vocal');
    expect(frames).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.frames.meterFps - 2);
    expect(frames).toBeLessThanOrEqual(DEFAULT_SETTINGS.frames.meterFps + 2);
    expect(host.count('dim')).toBe(dimBefore);
  });

  it('a Console Slot outside the layout is blank', () => {
    deck.appear({
      id: 'slot',
      device: 'XL',
      kind: 'slot',
      coordinates: { column: 9, row: 0 },
      settings: {},
    });
    advance(20);
    expect(host.count('slot')).toBe(1);
    expect(host.view('slot')).toBeUndefined();
    expect(host.images.get('slot')?.[0]).toMatch(/^data:image\/svg\+xml/);
  });

  it('a gesture goes to what the key was when it was pressed', () => {
    place('tb', 'monitor', { function: 'talkback' });
    deck.down('tb');
    advance(50);
    deck.settingsChanged('tb', { function: 'dim' });
    deck.up('tb');
    advance(500);
    expect(value(controlRoom('talkback'))).toBe(false);
    expect(value(controlRoom('dim'))).toBe(false);
    expect(host.view('tb')).toMatchObject({ function: 'dim' });
  });

  it('a key that goes away forgets its press', () => {
    place('vocal', 'channel', { bus: 'input', index: 8 });
    deck.down('vocal');
    deck.disappear('vocal');
    advance(1000);
    deck.up('vocal');
    expect(mixer.writes).toEqual([]);
    const sent = host.count('vocal');
    mixer.sim.setValue('/input/8/name', 'Lead');
    mixer.resync();
    advance(1000);
    expect(host.count('vocal')).toBe(sent);
  });

  it('new settings change the theme now and the timings from the next press', () => {
    place('vocal', 'channel', { bus: 'input', index: 8, hold: 'phantom' });
    expect(host.theme('vocal')).toBe('dark');
    const longPressMs = 1000;
    deck.configure({
      ...DEFAULT_SETTINGS,
      theme: 'high-contrast',
      gestures: { ...DEFAULT_SETTINGS.gestures, longPressMs },
    });
    advance(100);
    expect(host.theme('vocal')).toBe('high-contrast');
    press('vocal', 600);
    advance(400);
    expect(mixer.writes).toEqual([[channel('input', 8, 'mute'), true]]);
  });

  it('a controller that throws is logged and shown as an alert', () => {
    place('vocal', 'channel', { bus: 'input', index: 8, hold: 'none' });
    mixer.set = () => {
      throw new Error('boom');
    };
    deck.down('vocal');
    deck.up('vocal');
    expect(host.alerts).toEqual(['vocal']);
    expect(errors).toHaveLength(1);
  });

  it('Test Images keys page through their images and switch between SVG and PNG', () => {
    const debug = new DeckRuntime({
      mixer,
      host,
      clock: mixer.clock,
      render: renderJson,
      debugImages: {
        pages: 2,
        title: (page) => `page ${String(page)}`,
        image: (page, position, mode) =>
          position > 1 ? undefined : `${String(page)}/${String(position)}/${mode}`,
      },
    });
    for (const column of [0, 1, 2]) {
      debug.appear({
        id: `t${String(column)}`,
        device: 'XL',
        kind: 'test-image',
        coordinates: { column, row: 0 },
        settings: {},
      });
    }
    advance(100);
    const last = (id: string) => host.images.get(id)?.at(-1);
    expect([last('t0'), last('t1')]).toEqual(['0/0/svg', '0/1/svg']);
    expect(last('t2')).toMatch(/^data:image\/svg/);
    debug.down('t1');
    advance(30);
    debug.up('t1');
    advance(200);
    expect([last('t0'), last('t1')]).toEqual(['1/0/svg', '1/1/svg']);
    debug.down('t0');
    advance(DEFAULT_SETTINGS.gestures.longPressMs + 50);
    debug.up('t0');
    advance(200);
    expect([last('t0'), last('t1')]).toEqual(['1/0/png', '1/1/png']);
    expect(host.oks).toEqual(['t0']);
    debug.dispose();
  });

  it('stops drawing after dispose', () => {
    place('vocal', 'channel', { bus: 'input', index: 8 });
    deck.dispose();
    const sent = host.count('vocal');
    mixer.store.meters.push('input', 8, -3, mixer.clock.now());
    advance(1000);
    expect(host.count('vocal')).toBe(sent);
  });
});
