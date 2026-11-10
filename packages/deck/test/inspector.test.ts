// The Property Inspector's model: what each action's inspector offers, live from the mixer,
// and how a change from the page lands in the action's settings.
import { describe, expect, it } from 'vitest';
import {
  changeSetting,
  DEFAULT_SETTINGS,
  DeckRuntime,
  INSPECTOR_REFRESH_MS,
  Inspectors,
  inspectorView,
  readInspectorRequest,
  type ActionKind,
  type InspectorField,
  type InspectorUpdate,
  type InspectorView,
  type JsonObject,
} from '../src/index.ts';
import { renderJson, TestHost } from './host.ts';
import { Loopback } from './loopback.ts';

const NAMES = ['Tracking', 'Overdubs'];

function viewOf(kind: ActionKind, settings: JsonObject = {}, mixer = new Loopback().connect()) {
  return inspectorView({
    kind,
    settings,
    store: mixer.store,
    global: { ...DEFAULT_SETTINGS, levels: { 'main/2': -18 } },
    snapshotName: (n) => NAMES[n - 1],
  });
}

const field = (view: InspectorView, key: string): InspectorField => {
  const f = view.fields.find((x) => x.key === key);
  if (!f) throw new Error(`no field ${key}`);
  return f;
};

const labels = (f: InspectorField) => f.options.map((o) => o.label);

describe('the inspector view', () => {
  it('offers the channels TotalMix shows, by name, and says what the key is', () => {
    const view = viewOf('channel', { bus: 'input', index: 9 });
    expect(view.title).toBe('Channel');
    expect(view.summary).toBe('Input Mic 10 · Guitar.');
    expect(view.status).toEqual({ state: 'ok', text: 'Connected to Fireface UFX III' });
    expect(view.section).toBe('channels');
    expect(view.fields.map((f) => f.key)).toEqual(['bus', 'index', 'tap', 'hold', 'style']);
    const index = field(view, 'index');
    expect(index.value).toBe(9);
    expect(labels(index)).toEqual([
      'First channel',
      'AN 1/2 · Synth',
      'Mic 9 · Vocal',
      'Mic 10 · Guitar',
      'Mic 11/12 · Room',
    ]);
    // Defaults show as the values in use.
    expect(field(view, 'tap').value).toBe('mute');
    expect(field(view, 'hold').value).toBe('detail');
    expect(field(view, 'style').value).toBe('full');
  });

  it('keeps a channel TotalMix does not show, and says so', () => {
    const view = viewOf('channel', { bus: 'input', index: 4 });
    expect(view.summary).toBe('Input 5, which TotalMix does not show now.');
    expect(labels(field(view, 'index')).at(-1)).toBe('Input 5 (not shown)');
  });

  it('waits for TotalMix to fill the lists', () => {
    const view = viewOf('channel', {}, new Loopback());
    expect(view.status).toEqual({ state: 'off', text: 'Not connected' });
    const index = field(view, 'index');
    expect(index.value).toBeNull();
    expect(labels(index)).toEqual(['First channel']);
    expect(index.help).toBe('The list fills once TotalMix is connected.');
  });

  it('offers Main and the Phones by what TotalMix assigns, then every output', () => {
    const view = viewOf('output', { output: 'phones1' });
    const output = field(view, 'output');
    expect(output.value).toBe('phones1');
    expect(output.options.slice(0, 3)).toEqual([
      { value: 'main', label: 'Main (AN 1/2 · Main)', group: 'Follows TotalMix' },
      { value: 'phones1', label: 'Phones 1 (PH 9/10 · Phones 1)', group: 'Follows TotalMix' },
      { value: 'phones2', label: 'Phones 2 (PH 11/12 · Phones 2)', group: 'Follows TotalMix' },
    ]);
    expect(output.options.filter((o) => o.group === 'Outputs').map((o) => o.value)).toEqual([
      0, 8, 10,
    ]);
    expect(view.summary).toBe('Phones 1 (PH 9/10 · Phones 1): volume and meter.');
  });

  it('names the snapshots and the saved preset levels', () => {
    expect(labels(field(viewOf('snapshot', { n: 2 }), 'n')).slice(0, 3)).toEqual([
      '1 · Tracking',
      '2 · Overdubs',
      '3',
    ]);
    const preset = viewOf('preset', { output: 'main', n: 2 });
    expect(labels(field(preset, 'n')).slice(0, 2)).toEqual(['1 · nothing saved', '2 · −18.0 dB']);
    expect(preset.summary).toBe('Main (AN 1/2 · Main), preset 2: −18.0 dB.');
  });

  it('tells a Console Slot what it shows now, with nothing to set', () => {
    const mixer = new Loopback().connect();
    const view = inspectorView({
      kind: 'slot',
      settings: {},
      store: mixer.store,
      global: DEFAULT_SETTINGS,
      slot: { type: 'channel', bus: 'input', index: 8 },
      snapshotName: () => undefined,
    });
    expect(view.fields).toEqual([]);
    expect(view.summary).toBe('Now: Input Mic 9 · Vocal.');
    expect(view.note).toMatch(/^A key of the Console layout/);
    expect(view.section).toBe('layout');
  });

  it('has nothing to set on Status, Console and Exit', () => {
    for (const kind of ['status', 'console', 'exit'] as const) {
      expect(viewOf(kind).fields).toEqual([]);
      expect(viewOf(kind).section).toBe('connection');
    }
  });
});

describe('changes from the inspector', () => {
  it('sets a value, and null takes it out so the default applies', () => {
    expect(changeSetting('channel', { bus: 'input' }, 'tap', 'solo')).toEqual({
      bus: 'input',
      tap: 'solo',
    });
    expect(changeSetting('channel', { bus: 'input', index: 8 }, 'index', null)).toEqual({
      bus: 'input',
    });
  });

  it('clears the channel when the row changes', () => {
    expect(changeSetting('channel', { bus: 'input', index: 8 }, 'bus', 'playback')).toEqual({
      bus: 'playback',
    });
    expect(changeSetting('channel', { bus: 'input', index: 8 }, 'bus', 'input')).toEqual({
      bus: 'input',
      index: 8,
    });
  });

  it('refuses settings the action does not have', () => {
    expect(changeSetting('status', {}, 'n', 2)).toBeUndefined();
    expect(changeSetting('snapshot', {}, 'output', 'main')).toBeUndefined();
  });

  it('reads only well-formed requests from the page', () => {
    expect(readInspectorRequest({ event: 'set', key: 'n', value: 3 })).toEqual({
      event: 'set',
      key: 'n',
      value: 3,
    });
    expect(readInspectorRequest({ event: 'set', key: 'n', value: [3] })).toBeUndefined();
    expect(readInspectorRequest({ event: 'set', value: 3 })).toBeUndefined();
    expect(readInspectorRequest({ event: 'other' })).toBeUndefined();
    expect(readInspectorRequest('hello')).toBeUndefined();
  });
});

describe('open inspectors', () => {
  function setup() {
    const mixer = new Loopback().connect();
    const host = new TestHost();
    const deck = new DeckRuntime({ mixer, host, clock: mixer.clock, render: renderJson });
    deck.appear({ id: 'k', device: 'XL', kind: 'snapshot', settings: { n: 1 } });
    const sent: InspectorUpdate[] = [];
    const stored: JsonObject[] = [];
    const opened: string[] = [];
    const inspectors = new Inspectors(
      {
        view: (id) => deck.inspect(id),
        change: (id, key, value) => {
          const next = deck.changeSetting(id, key, value);
          if (next) stored.push(next);
          return next !== undefined;
        },
        send: (_id, update) => sent.push(update),
        openControlCenter: (section) => opened.push(section),
      },
      mixer.clock,
    );
    return { mixer, host, deck, inspectors, sent, stored, opened };
  }

  it('sends the view on hello, and again after a change, which the key follows', () => {
    const { mixer, host, inspectors, sent, stored } = setup();
    inspectors.message('k', { event: 'hello' });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.view.summary).toBe('Loads snapshot 1.');
    inspectors.message('k', { event: 'set', key: 'n', value: 3 });
    expect(stored).toEqual([{ n: 3 }]);
    expect(sent.at(-1)?.view.summary).toBe('Loads snapshot 3.');
    mixer.clock.advance(50);
    expect(host.view('k')).toMatchObject({ kind: 'snapshot', n: 3 });
  });

  it('sends a new view when the mixer changes, and nothing when it does not', () => {
    const { mixer, inspectors, sent } = setup();
    inspectors.appear('k');
    mixer.clock.advance(INSPECTOR_REFRESH_MS * 3);
    expect(sent).toHaveLength(1);
    mixer.answering = false;
    // TotalMix stops answering: the status line follows.
    mixer.clock.advance(10_000);
    expect(sent.at(-1)?.view.status.state).toBe('fail');
    const count = sent.length;
    inspectors.disappear('k');
    mixer.answering = true;
    mixer.resync();
    mixer.clock.advance(10_000);
    expect(sent).toHaveLength(count);
  });

  it('opens the Control Center on the section for the key', () => {
    const { inspectors, opened } = setup();
    inspectors.message('k', { event: 'openControlCenter' });
    expect(opened).toEqual(['channels']);
  });
});
